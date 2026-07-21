const Anthropic = require('@anthropic-ai/sdk')
const {
  buildSummaryPrompt,
  buildQuizPrompt,
  buildAffiliationsPrompt,
  buildMetadataPrompt,
  buildAbstractSummaryPrompt,
  buildOcrPagePrompt,
  buildFigureInterpretationPrompt,
  candidateAffiliationLines,
  parseJSONResponse,
} = require('../prompts')

const DEFAULT_MODEL = 'claude-opus-4-8'

function extractText(content) {
  return content.filter(b => b.type === 'text').map(b => b.text).join('')
}

function createAnthropicProvider(apiKey, model = null, _client = null, onUsage = null, language = 'es') {
  const MODEL = model || DEFAULT_MODEL
  const client = _client || new Anthropic({ apiKey })

  // El tracking de costos vive acá adentro, no en los IPC handlers: cualquier
  // consumidor nuevo de estos métodos queda instrumentado sin tocar su call site.
  // Solo se registra en el camino feliz — una llamada que falló no se cobra.
  function record(action_type, usage) {
    if (!onUsage) return
    onUsage({
      action_type,
      provider: 'anthropic',
      model: MODEL,
      prompt_tokens:     usage?.input_tokens  ?? null,
      completion_tokens: usage?.output_tokens ?? null,
    })
  }

  return {
    async streamSummary(paper, onChunk) {
      let fullText = ''
      const stream = client.messages.stream({
        model: MODEL,
        max_tokens: 16000,
        thinking: { type: 'adaptive' },
        messages: [{ role: 'user', content: buildSummaryPrompt(paper, language) }],
      })
      for await (const text of stream.textStream) {
        onChunk(text)
        fullText += text
      }
      // Anthropic reporta el uso en el mensaje final del stream, no en los chunks.
      // Si el stream no expone finalMessage, se registra igual la llamada sin
      // tokens (queda como "costo desconocido") en vez de perder el evento.
      const final = typeof stream.finalMessage === 'function' ? await stream.finalMessage() : null
      record('summary', final?.usage)
      return fullText
    },

    async generateQuiz(paper) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 2048,
        messages: [{ role: 'user', content: buildQuizPrompt(paper, language) }],
      })
      record('quiz', response.usage)
      return parseJSONResponse(extractText(response.content))
    },

    async chat(messages) {
      const system = messages.find(m => m.role === 'system')?.content || ''
      const rest   = messages.filter(m => m.role !== 'system')
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 2048,
        ...(system ? { system } : {}),
        messages: rest,
      })
      record('chat', response.usage)
      return extractText(response.content)
    },

    async extractAffiliationsWithAI(firstPageText) {
      const context = candidateAffiliationLines(firstPageText).join('\n')
      try {
        const response = await client.messages.create({
          model: MODEL,
          max_tokens: 300,
          messages: [{ role: 'user', content: buildAffiliationsPrompt(context) }],
        })
        record('affiliations', response.usage)
        const parsed = parseJSONResponse(extractText(response.content))
        return Array.isArray(parsed) ? parsed : null
      } catch {
        return null
      }
    },

    async interpretImage(base64, mimeType = 'image/jpeg') {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 400,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
          { type: 'text', text: 'Describe esta diapositiva de forma concisa: idea principal, puntos clave, diagramas o fórmulas visibles. Máximo 4 oraciones.' }
        ]}]
      })
      record('vision', response.usage)
      return extractText(response.content)
    },

    // OCR fiel de una página: transcripción exhaustiva a Markdown. max_tokens
    // muy por encima de interpretImage (400) porque una página densa a dos
    // columnas puede pasar los 1500-2000 tokens de salida.
    async transcribePageToMarkdown(base64, mimeType = 'image/png') {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
          { type: 'text', text: buildOcrPagePrompt() }
        ]}]
      })
      record('ocr', response.usage)
      return extractText(response.content)
    },

    // Interpretación profunda de una figura concreta (siempre corre como parte
    // del OCR — ver src/ingestion/ocr.js). Se contabiliza aparte del texto de
    // página bajo su propio action_type ('ocr_figure') para que el dashboard
    // de costos distinga cuánto se gastó en cada cosa.
    async interpretFigureInDepth(base64, mimeType = 'image/png') {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
          { type: 'text', text: buildFigureInterpretationPrompt() }
        ]}]
      })
      record('ocr_figure', response.usage)
      return extractText(response.content)
    },

    async extractPaperMetadata(firstPageText) {
      try {
        const response = await client.messages.create({
          model: MODEL,
          max_tokens: 500,
          messages: [{ role: 'user', content: buildMetadataPrompt(firstPageText) }],
        })
        record('metadata', response.usage)
        return parseJSONResponse(extractText(response.content))
      } catch {
        return { title: '', authors: '', abstract: '' }
      }
    },

    async summarizeAbstract(abstract) {
      try {
        const response = await client.messages.create({
          model: MODEL,
          max_tokens: 150,
          messages: [{ role: 'user', content: buildAbstractSummaryPrompt(abstract) }],
        })
        record('abstract_summary', response.usage)
        return extractText(response.content).trim()
      } catch {
        return (abstract || '').slice(0, 200)
      }
    },
  }
}

module.exports = { createAnthropicProvider }