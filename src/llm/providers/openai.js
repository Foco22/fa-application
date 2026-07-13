const OpenAI = require('openai')
const {
  buildSummaryPrompt,
  buildQuizPrompt,
  buildAffiliationsPrompt,
  buildMetadataPrompt,
  buildAbstractSummaryPrompt,
  candidateAffiliationLines,
  parseJSONResponse,
} = require('../prompts')

function createOpenAICompatibleProvider(apiKey, { baseURL, model, jsonMode = false, supportsVision = true, providerName = 'openai', language = 'es' } = {}, _client = null, onUsage = null) {
  const client = _client || new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) })
  const MODEL = model || 'gpt-4o'

  // El tracking vive dentro del proveedor, no en los IPC handlers: un call site
  // nuevo queda instrumentado solo. Se registra unicamente en el camino feliz.
  function record(action_type, usage) {
    if (!onUsage) return
    onUsage({
      action_type,
      provider: providerName,
      model: MODEL,
      prompt_tokens:     usage?.prompt_tokens     ?? null,
      completion_tokens: usage?.completion_tokens ?? null,
    })
  }

  return {
    async streamSummary(paper, onChunk) {
      const params = {
        model: MODEL,
        max_tokens: 8192,
        stream: true,
        // Sin include_usage, OpenAI NO devuelve uso en streaming y el resumen
        // (el flujo mas caro de la app) quedaria sin costo.
        stream_options: { include_usage: true },
        messages: [{ role: 'user', content: buildSummaryPrompt(paper, language) }],
      }
      if (jsonMode) params.response_format = { type: 'json_object' }
      const stream = await client.chat.completions.create(params)
      let fullText = ''
      let usage = null
      for await (const chunk of stream) {
        // El uso llega en un chunk final sin choices.
        if (chunk.usage) usage = chunk.usage
        const text = chunk.choices[0]?.delta?.content
        if (text) {
          onChunk(text)
          fullText += text
        }
      }
      record('summary', usage)
      return fullText
    },

    async generateQuiz(paper) {
      const response = await client.chat.completions.create({
        model: MODEL,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: buildQuizPrompt(paper, language) }],
      })
      record('quiz', response.usage)
      return parseJSONResponse(response.choices[0].message.content)
    },

    async chat(messages) {
      const response = await client.chat.completions.create({ model: MODEL, messages })
      record('chat', response.usage)
      const msg = response.choices[0].message
      // reasoning models (e.g. DeepSeek R1-style) put the answer in content and
      // the thinking in reasoning_content — but content can be null if only
      // reasoning_content is populated; fall back so we always return something
      return msg.content || msg.reasoning_content || null
    },

    async extractAffiliationsWithAI(firstPageText) {
      const context = candidateAffiliationLines(firstPageText).join('\n')
      try {
        const response = await client.chat.completions.create({
          model: MODEL,
          max_tokens: 300,
          messages: [{ role: 'user', content: buildAffiliationsPrompt(context) }],
        })
        record('affiliations', response.usage)
        const parsed = parseJSONResponse(response.choices[0].message.content)
        return Array.isArray(parsed) ? parsed : null
      } catch {
        return null
      }
    },

    async extractPaperMetadata(firstPageText) {
      try {
        const response = await client.chat.completions.create({
          model: MODEL,
          max_tokens: 500,
          messages: [{ role: 'user', content: buildMetadataPrompt(firstPageText) }],
        })
        record('metadata', response.usage)
        return parseJSONResponse(response.choices[0].message.content)
      } catch {
        return { title: '', authors: '', abstract: '' }
      }
    },

    async summarizeAbstract(abstract) {
      try {
        const response = await client.chat.completions.create({
          model: MODEL,
          max_tokens: 150,
          messages: [{ role: 'user', content: buildAbstractSummaryPrompt(abstract) }],
        })
        record('abstract_summary', response.usage)
        return (response.choices[0].message.content || '').trim()
      } catch {
        return (abstract || '').slice(0, 200)
      }
    },

    async interpretImage(base64, mimeType = 'image/jpeg') {
      if (!supportsVision) return null
      const response = await client.chat.completions.create({
        model: MODEL,
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
            { type: 'text', text: 'Describe esta diapositiva de forma concisa: idea principal, puntos clave, diagramas o fórmulas visibles. Máximo 4 oraciones.' }
          ]
        }]
      })
      record('vision', response.usage)
      return response.choices[0].message.content
    },
  }
}

function createOpenAIProvider(apiKey, model = null, _client = null, onUsage = null, language = 'es') {
  return createOpenAICompatibleProvider(apiKey, { model: model || 'gpt-4o', jsonMode: true, providerName: 'openai', language }, _client, onUsage)
}

module.exports = { createOpenAIProvider, createOpenAICompatibleProvider }
