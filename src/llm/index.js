const { createOpenAIProvider } = require('./providers/openai')
const { createAnthropicProvider } = require('./providers/anthropic')
const { createDeepSeekProvider } = require('./providers/deepseek')

// `onUsage` (opcional) recibe un evento por cada llamada pagada. Se inyecta una
// sola vez desde main.js: los IPC handlers siguen llamando a createLLM(settings)
// sin enterarse de que existe el tracking de costos.
function createLLM(settings, onUsage = null) {
  const provider = settings.llmProvider || 'openai'
  const apiKey   = settings.apiKey
  const model    = settings.llmModel || undefined
  // El idioma de la app decide en qué idioma genera el LLM: resumen, quiz y chat
  // salen en el mismo idioma que la interfaz, sin mezclar.
  const language = settings.language || 'es'
  switch (provider) {
    case 'anthropic': return createAnthropicProvider(apiKey, model, null, onUsage, language)
    case 'deepseek':  return createDeepSeekProvider(apiKey, model, null, onUsage, language)
    default:          return createOpenAIProvider(apiKey, model, null, onUsage, language)
  }
}

module.exports = { createLLM }
