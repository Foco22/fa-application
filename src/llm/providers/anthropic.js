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

// Normaliza el uso reportado por Anthropic (input/output_tokens) al esquema
// común { prompt_tokens, completion_tokens } que consume el registro de costos.
function normalizeUsage(usage) {
  return {
    prompt_tokens:     usage?.input_tokens  ?? 0,
    completion_tokens: usage?.output_tokens ?? 0,
  }
}

function createAnthropicProvider(apiKey, model = null, _client = null) {
  const MODEL = model || DEFAULT_MODEL
  const client = _client || new Anthropic({ apiKey })

  return {
    async streamSummary(paper, onChunk) {
      let fullText = ''
      const stream = client.messages.stream({
        model: MODEL,
        max_tokens: 16000,
        thinking: { type: 'adaptive' },
        messages: [{ role: 'user', content: buildSummaryPrompt(paper) }],
      })
      for await (const text of stream.textStream) {
        onChunk(text)
        fullText += text
      }
      return fullText
    },

    async generateQuiz(paper) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 2048,
        messages: [{ role: 'user', content: buildQuizPrompt(paper) }],
      })
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
      return extractText(response.content)
    },

    // OCR fiel de una página: transcripción exhaustiva a Markdown. max_tokens
    // muy por encima de interpretImage (400) porque una página densa a dos
    // columnas puede pasar los 1500-2000 tokens de salida. onUsage se llama solo
    // en el camino feliz (una llamada fallida no se cobra).
    async transcribePageToMarkdown(base64, mimeType = 'image/png', { onUsage } = {}) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
          { type: 'text', text: buildOcrPagePrompt() }
        ]}]
      })
      const text = extractText(response.content)
      if (onUsage) onUsage(normalizeUsage(response.usage))
      return text
    },

    // Interpretación profunda de una figura concreta (opt-in). Se contabiliza
    // aparte del OCR (action_type 'ocr_figure') vía el onUsage inyectado.
    async interpretFigureInDepth(base64, mimeType = 'image/png', { onUsage } = {}) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
          { type: 'text', text: buildFigureInterpretationPrompt() }
        ]}]
      })
      const text = extractText(response.content)
      if (onUsage) onUsage(normalizeUsage(response.usage))
      return text
    },

    async extractPaperMetadata(firstPageText) {
      try {
        const response = await client.messages.create({
          model: MODEL,
          max_tokens: 500,
          messages: [{ role: 'user', content: buildMetadataPrompt(firstPageText) }],
        })
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
        return extractText(response.content).trim()
      } catch {
        return (abstract || '').slice(0, 200)
      }
    },
  }
}

module.exports = { createAnthropicProvider }