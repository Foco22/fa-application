const OpenAI = require('openai')

function createOpenAIEmbeddingProvider(apiKey, { model = 'text-embedding-3-small' } = {}, _client = null, onUsage = null) {
  const client = _client || new OpenAI({ apiKey })
  return {
    id: `openai:${model}`,
    async generateEmbedding(text) {
      const res = await client.embeddings.create({ model, input: text.slice(0, 8000) })
      // Se registra despues de la llamada exitosa, con los tokens reales que
      // reporto OpenAI — nunca una estimacion por conteo de caracteres.
      if (onUsage) {
        onUsage({
          action_type: 'embedding',
          provider: 'openai',
          model,
          prompt_tokens: res.usage?.total_tokens ?? null,
        })
      }
      return res.data[0].embedding
    }
  }
}

module.exports = { createOpenAIEmbeddingProvider }
