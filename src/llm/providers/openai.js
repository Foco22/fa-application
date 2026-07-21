const OpenAI = require('openai')
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

function createOpenAICompatibleProvider(apiKey, { baseURL, model, jsonMode = false, supportsVision = true } = {}, _client = null) {
  const client = _client || new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) })
  const MODEL = model || 'gpt-4o'

  const provider = {
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

    async summarizeAbstract(abstract) {
      try {
        const response = await client.chat.completions.create({
          model: MODEL,
          max_tokens: 150,
          messages: [{ role: 'user', content: buildAbstractSummaryPrompt(abstract) }],
        })
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
      return response.choices[0].message.content
    },
  }

  // Los métodos de visión OCR solo se exponen si el proveedor soporta visión.
  // DeepSeek (supportsVision: false) queda sin ellos a propósito, de modo que
  // el guard `if (!llm.transcribePageToMarkdown)` de los callers lo detecte.
  if (supportsVision) {
    // OCR fiel de una página a Markdown. max_tokens muy por encima de
    // interpretImage (400): una página densa puede superar 1500-2000 tokens.
    provider.transcribePageToMarkdown = async (base64, mimeType = 'image/png', { onUsage } = {}) => {
      const response = await client.chat.completions.create({
        model: MODEL,
        max_tokens: 4096,
        messages: [{ role: 'user', content: [
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
          { type: 'text', text: buildOcrPagePrompt() }
        ]}]
      })
      const text = response.choices[0].message.content
      if (onUsage && response.usage) {
        onUsage({ prompt_tokens: response.usage.prompt_tokens, completion_tokens: response.usage.completion_tokens })
      }
      return text
    }

    // Interpretación profunda de una figura (opt-in, action_type 'ocr_figure').
    provider.interpretFigureInDepth = async (base64, mimeType = 'image/png', { onUsage } = {}) => {
      const response = await client.chat.completions.create({
        model: MODEL,
        max_tokens: 1024,
        messages: [{ role: 'user', content: [
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
          { type: 'text', text: buildFigureInterpretationPrompt() }
        ]}]
      })
      const text = response.choices[0].message.content
      if (onUsage && response.usage) {
        onUsage({ prompt_tokens: response.usage.prompt_tokens, completion_tokens: response.usage.completion_tokens })
      }
      return text
    }
  }

  return provider
}

function createOpenAIProvider(apiKey, model = null, _client = null) {
  return createOpenAICompatibleProvider(apiKey, { model: model || 'gpt-4o', jsonMode: true }, _client)
}

module.exports = { createOpenAIProvider, createOpenAICompatibleProvider }
