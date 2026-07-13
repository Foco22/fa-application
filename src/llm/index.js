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
  switch (provider) {
    case 'anthropic': return createAnthropicProvider(apiKey, model, null, onUsage)
    case 'deepseek':  return createDeepSeekProvider(apiKey, model, null, onUsage)
    default:          return createOpenAIProvider(apiKey, model, null, onUsage)
  }
}

module.exports = { createLLM }
