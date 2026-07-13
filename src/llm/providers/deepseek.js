const { createOpenAICompatibleProvider } = require('./openai')

function createDeepSeekProvider(apiKey, model = null, _client = null, onUsage = null) {
  return createOpenAICompatibleProvider(
    apiKey,
    { baseURL: 'https://api.deepseek.com/v1', model: model || 'deepseek-chat', supportsVision: false, providerName: 'deepseek' },
    _client,
    onUsage
  )
}

module.exports = { createDeepSeekProvider }
