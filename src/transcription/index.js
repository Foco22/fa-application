const OpenAI = require('openai')
const { File } = require('node:buffer')

const PROVIDERS = {
  openai: { baseURL: null,                              defaultModel: 'gpt-4o-mini-transcribe' },
  groq:   { baseURL: 'https://api.groq.com/openai/v1', defaultModel: 'whisper-large-v3-turbo'  },
}

function createTranscription(apiKey, options = {}, _client = null) {
  const provider = PROVIDERS[options.provider] || PROVIDERS.openai
  const model    = options.model || provider.defaultModel
  const client   = _client || new OpenAI({
    apiKey,
    ...(provider.baseURL ? { baseURL: provider.baseURL } : {})
  })

  return {
    async transcribe(audio, mimeType = 'audio/webm', language, prompt) {
      const buffer = Buffer.from(audio)
      const file   = new File([buffer], 'audio.webm', { type: mimeType })
      const params = { file, model }
      if (language) params.language = language
      if (prompt)   params.prompt   = prompt
      const result = await client.audio.transcriptions.create(params)
      return { text: result.text }
    }
  }
}

module.exports = { createTranscription }