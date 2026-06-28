const OpenAI = require('openai')
const {
  buildSummaryPrompt,
  buildQuizPrompt,
  buildAffiliationsPrompt,
  buildMetadataPrompt,
  candidateAffiliationLines,
  parseJSONResponse,
} = require('../prompts')

function createOpenAICompatibleProvider(apiKey, { baseURL, model, jsonMode = false, supportsVision = true } = {}, _client = null) {
  const client = _client || new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) })
  const MODEL = model || 'gpt-4o'

  return {
    async streamSummary(paper, onChunk) {
      const params = {
        model: MODEL,
        max_tokens: 8192,
        stream: true,
        messages: [{ role: 'user', content: buildSummaryPrompt(paper) }],
      }
      if (jsonMode) params.response_format = { type: 'json_object' }
      const stream = await client.chat.completions.create(params)
      let fullText = ''
      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content
        if (text) {
          onChunk(text)
          fullText += text
        }
      }
      return fullText
    },

    async generateQuiz(paper) {
      const response = await client.chat.completions.create({
        model: MODEL,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: buildQuizPrompt(paper) }],
      })
      return parseJSONResponse(response.choices[0].message.content)
    },

    async chat(messages) {
      const response = await client.chat.completions.create({ model: MODEL, messages })
      return response.choices[0].message.content
    },

    async extractAffiliationsWithAI(firstPageText) {
      const context = candidateAffiliationLines(firstPageText).join('\n')
      try {
        const response = await client.chat.completions.create({
          model: MODEL,
          max_tokens: 300,
          messages: [{ role: 'user', content: buildAffiliationsPrompt(context) }],
        })
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
        return parseJSONResponse(response.choices[0].message.content)
      } catch {
        return { title: '', authors: '', abstract: '' }
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
      return response.choices[0].message.content
    },
  }
}

function createOpenAIProvider(apiKey, model = null, _client = null) {
  return createOpenAICompatibleProvider(apiKey, { model: model || 'gpt-4o', jsonMode: true }, _client)
}

module.exports = { createOpenAIProvider, createOpenAICompatibleProvider }
