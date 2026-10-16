const OpenAI = require('openai')

// La API acepta hasta 2048 inputs por petición; 256 deja margen bajo el tope de
// tokens por petición y mantiene cada llamada rápida.
const BATCH_SIZE = 256

function createOpenAIEmbeddingProvider(apiKey, { model = 'text-embedding-3-small' } = {}, _client = null, onUsage = null) {
  const client = _client || new OpenAI({ apiKey })

  // Se registra despues de la llamada exitosa, con los tokens reales que
  // reporto OpenAI — nunca una estimacion por conteo de caracteres.
  function recordUsage(res) {
    if (onUsage) {
      onUsage({
        action_type: 'embedding',
        provider: 'openai',
        model,
        prompt_tokens: res.usage?.total_tokens ?? null,
      })
    }
  }

  return {
    id: `openai:${model}`,
    async generateEmbedding(text) {
      const res = await client.embeddings.create({ model, input: text.slice(0, 8000) })
      recordUsage(res)
      return res.data[0].embedding
    },
    // Un viaje de red por lote en vez de uno por texto: con miles de abstracts la
    // latencia de las llamadas sueltas dominaba el tiempo total del fetch.
    async generateEmbeddings(texts, onProgress = null) {
      const out = []
      for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const chunk = texts.slice(i, i + BATCH_SIZE).map(t => t.slice(0, 8000))
        const res = await client.embeddings.create({ model, input: chunk })
        recordUsage(res)
        // La respuesta trae `index`: se reordena por él en vez de fiarse del orden de llegada.
        const ordered = [...res.data].sort((a, b) => a.index - b.index)
        for (const item of ordered) out.push(item.embedding)
        if (onProgress) onProgress(out.length, texts.length)
      }
      return out
    },
  }
}

module.exports = { createOpenAIEmbeddingProvider, BATCH_SIZE }
