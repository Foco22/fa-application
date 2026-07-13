const OpenAI = require('openai')

function createOpenAIEmbeddingProvider(apiKey, { model = 'text-embedding-3-small' } = {}, _client = null) {
  const client = _client || new OpenAI({ apiKey })
  return {
    id: `openai:${model}`,
    async generateEmbedding(text) {
      const res = await client.embeddings.create({ model, input: text.slice(0, 8000) })
      return res.data[0].embedding
    }
  }
}

module.exports = { createOpenAIEmbeddingProvider }