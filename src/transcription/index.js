const OpenAI = require('openai')
const { File } = require('node:buffer')

const PROVIDERS = {
  openai: { baseURL: null,                              defaultModel: 'gpt-4o-mini-transcribe' },
  groq:   { baseURL: 'https://api.groq.com/openai/v1', defaultModel: 'whisper-large-v3-turbo'  },
}

// La transcripción no tiene un único modelo de cobro:
//   - Whisper (Groq y whisper-1) factura por AUDIO — hay que pedir verbose_json
//     para que la API devuelva `duration`, si no no hay con qué calcular el costo.
//   - Los gpt-4o-*-transcribe facturan por TOKENS y encima no soportan
//     verbose_json; su uso viene en `usage`.
function billsPerAudioSecond(model) {
  return model.includes('whisper')
}

function createTranscription(apiKey, options = {}, _client = null, onUsage = null) {
  const provider     = PROVIDERS[options.provider] || PROVIDERS.openai
  const providerName = PROVIDERS[options.provider] ? options.provider : 'openai'
  const model        = options.model || provider.defaultModel
  const client       = _client || new OpenAI({
    apiKey,
    ...(provider.baseURL ? { baseURL: provider.baseURL } : {})
  })

  return {
    async transcribe(audio, mimeType = 'audio/webm', language, prompt) {
      const buffer = Buffer.from(audio)
      const file   = new File([buffer], 'audio.webm', { type: mimeType })
      const perAudio = billsPerAudioSecond(model)

      const params = { file, model }
      if (perAudio) params.response_format = 'verbose_json'
      if (language) params.language = language
      if (prompt)   params.prompt   = prompt

      const result = await client.audio.transcriptions.create(params)

      if (onUsage) {
        onUsage({
          action_type: 'transcription',
          provider: providerName,
          model,
          audio_seconds:     perAudio ? (result.duration ?? null) : null,
          prompt_tokens:     perAudio ? null : (result.usage?.input_tokens  ?? null),
          completion_tokens: perAudio ? null : (result.usage?.output_tokens ?? null),
        })
      }

      return { text: result.text }
    }
  }
}

module.exports = { createTranscription, billsPerAudioSecond }
