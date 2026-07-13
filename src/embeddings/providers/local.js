const os   = require('os')
const path = require('path')

const DEFAULT_LOCAL_MODEL = 'Xenova/all-MiniLM-L6-v2'

// Por defecto Transformers.js cachea los pesos dentro de node_modules, que en
// una app empaquetada vive dentro del asar (solo lectura). Se cachea en HOME.
const DEFAULT_CACHE_DIR = path.join(os.homedir(), '.cache', 'paper-learning', 'models')

// Transformers.js es ESM-only; este proyecto es CommonJS, así que se carga con
// import() dinámico dentro del loader (require() sobre él falla).
async function loadPipeline(model, cacheDir) {
  const { pipeline, env } = await import('@xenova/transformers')
  env.cacheDir = cacheDir
  return pipeline('feature-extraction', model)
}

// Corre 100% offline. La primera llamada descarga los pesos del modelo (~25 MB
// para MiniLM) y los cachea en disco; a partir de ahí no hay red ni API key.
function createLocalEmbeddingProvider({ model = DEFAULT_LOCAL_MODEL, cacheDir = DEFAULT_CACHE_DIR } = {}, _pipeline = null, _loader = loadPipeline) {
  // El modelo se carga una sola vez, y recién en el primer generateEmbedding:
  // construir el proveedor no debe costar una descarga.
  let pending = null
  function getPipeline() {
    if (_pipeline) return Promise.resolve(_pipeline)
    if (!pending) pending = _loader(model, cacheDir)
    return pending
  }

  return {
    id: `local:${model}`,
    async generateEmbedding(text) {
      const extract = await getPipeline()
      // mean + normalize deja los vectores en norma 1, igual que los de OpenAI,
      // para que el umbral de similitud coseno siga siendo interpretable.
      const output = await extract(text.slice(0, 8000), { pooling: 'mean', normalize: true })
      return Array.from(output.data)
    },
  }
}

module.exports = { createLocalEmbeddingProvider, DEFAULT_LOCAL_MODEL }