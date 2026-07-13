import { describe, it, expect, vi } from 'vitest'
import { createLocalEmbeddingProvider, DEFAULT_LOCAL_MODEL } from '../../../src/embeddings/providers/local.js'

// El pipeline de Transformers.js devuelve un Tensor con `.data` (Float32Array).
// Lo imitamos aquí para no descargar el modelo real en los tests.
function makePipeline(vector = [0.1, 0.2, 0.3]) {
  return vi.fn().mockResolvedValue({ data: Float32Array.from(vector) })
}

describe('createLocalEmbeddingProvider', () => {
  it('exposes generateEmbedding without needing an API key', () => {
    const provider = createLocalEmbeddingProvider({}, makePipeline())
    expect(typeof provider.generateEmbedding).toBe('function')
  })

  it('identifies itself as local:<model> so stored embeddings can be attributed', () => {
    const provider = createLocalEmbeddingProvider({}, makePipeline())
    expect(provider.id).toBe(`local:${DEFAULT_LOCAL_MODEL}`)
  })

  it('reflects a custom model in its id', () => {
    const provider = createLocalEmbeddingProvider({ model: 'Xenova/bge-small-en-v1.5' }, makePipeline())
    expect(provider.id).toBe('local:Xenova/bge-small-en-v1.5')
  })

  // Valores exactos en float32 (potencias de 2) para que la comparación no
  // dependa del redondeo de la conversión.
  it('returns a plain number[] (not a Float32Array) so it survives JSON.stringify', async () => {
    const provider = createLocalEmbeddingProvider({}, makePipeline([0.5, 0.25]))
    const emb = await provider.generateEmbedding('some text')
    expect(Array.isArray(emb)).toBe(true)
    expect(emb).toEqual([0.5, 0.25])
    expect(JSON.parse(JSON.stringify(emb))).toEqual([0.5, 0.25])
  })

  it('mean-pools and normalizes, matching the pooling used by the OpenAI provider', async () => {
    const pipeline = makePipeline()
    const provider = createLocalEmbeddingProvider({}, pipeline)
    await provider.generateEmbedding('some text')
    expect(pipeline).toHaveBeenCalledWith('some text', { pooling: 'mean', normalize: true })
  })

  it('truncates very long text before embedding it', async () => {
    const pipeline = makePipeline()
    const provider = createLocalEmbeddingProvider({}, pipeline)
    await provider.generateEmbedding('x'.repeat(20000))
    expect(pipeline.mock.calls[0][0].length).toBe(8000)
  })

  it('loads the model once and reuses it across calls', async () => {
    const pipeline = makePipeline()
    const loader = vi.fn().mockResolvedValue(pipeline)
    const provider = createLocalEmbeddingProvider({}, null, loader)

    await provider.generateEmbedding('a')
    await provider.generateEmbedding('b')

    expect(loader).toHaveBeenCalledTimes(1)
    expect(pipeline).toHaveBeenCalledTimes(2)
  })

  it('does not load the model until the first generateEmbedding call', () => {
    const loader = vi.fn().mockResolvedValue(makePipeline())
    createLocalEmbeddingProvider({}, null, loader)
    expect(loader).not.toHaveBeenCalled()
  })

  // El caché por defecto de Transformers.js cae dentro de node_modules, que en
  // la app empaquetada está dentro del asar (solo lectura).
  it('caches the model weights outside node_modules', async () => {
    const loader = vi.fn().mockResolvedValue(makePipeline())
    const provider = createLocalEmbeddingProvider({}, null, loader)
    await provider.generateEmbedding('a')

    const cacheDir = loader.mock.calls[0][1]
    expect(cacheDir).toBeTruthy()
    expect(cacheDir).not.toContain('node_modules')
  })

  it('honours an explicit cacheDir', async () => {
    const loader = vi.fn().mockResolvedValue(makePipeline())
    const provider = createLocalEmbeddingProvider({ cacheDir: '/models' }, null, loader)
    await provider.generateEmbedding('a')
    expect(loader).toHaveBeenCalledWith(DEFAULT_LOCAL_MODEL, '/models')
  })
})
