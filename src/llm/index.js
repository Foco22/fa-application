const { createOpenAIProvider } = require('./providers/openai')
const { createAnthropicProvider } = require('./providers/anthropic')
const { createDeepSeekProvider } = require('./providers/deepseek')

function createLLM(settings) {
  const provider = settings.llmProvider || 'openai'
  const apiKey   = settings.apiKey
  const model    = settings.llmModel || undefined
  switch (provider) {
    case 'anthropic': return createAnthropicProvider(apiKey, model)
    case 'deepseek':  return createDeepSeekProvider(apiKey, model)
    default:          return createOpenAIProvider(apiKey, model)
  }
}

module.exports = { createLLM }