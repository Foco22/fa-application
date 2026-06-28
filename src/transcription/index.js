const OpenAI = require('openai')
const { File } = require('node:buffer')

const DEFAULT_MODEL = 'gpt-4o-mini-transcribe'

function createTranscription(apiKey, options = {}, _client = null) {
  const client = _client || new OpenAI({ apiKey })
  const model = options.model || DEFAULT_MODEL

  return {
    async transcribe(audio, mimeType = 'audio/webm', language) {
      const buffer = Buffer.from(audio)
      const file = new File([buffer], 'audio.webm', { type: mimeType })
      const params = { file, model }
      if (language) params.language = language
      const result = await client.audio.transcriptions.create(params)
      return { text: result.text }
    }
  }
}

module.exports = { createTranscription }