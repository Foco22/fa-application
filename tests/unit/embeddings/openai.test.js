import { describe, it, expect, vi } from 'vitest'
import { createOpenAIEmbeddingProvider } from '../../../src/embeddings/providers/openai.js'

// Respuesta de la API: un vector por input, con `index`. Se devuelven DESORDENADOS
// a propósito: el proveedor debe reordenar por index, no confiar en el orden de llegada.
function makeClient() {
  return {
    embeddings: {
      create: vi.fn().mockImplementation(async ({ input }) => {
        const inputs = Array.isArray(input) ? input : [input]
        const data = inputs.map((text, index) => ({ index, embedding: [text.length] })).reverse()
        return { data, usage: { total_tokens: inputs.length * 10 } }
      }),
    },
  }
}

describe('createOpenAIEmbeddingProvider — generateEmbeddings (batch)', () => {
  it('sends the whole list in ONE request and returns vectors in input order', async () => {
    const client = makeClient()
    const provider = createOpenAIEmbeddingProvider('sk-test', {}, client)

    const out = await provider.generateEmbeddings(['a', 'bb', 'ccc'])

    expect(client.embeddings.create).toHaveBeenCalledOnce()
    expect(client.embeddings.create.mock.calls[0][0].input).toEqual(['a', 'bb', 'ccc'])
    expect(out).toEqual([[1], [2], [3]])
  })

  it('splits big lists into several requests and keeps the global order', async () => {
    const client = makeClient()
    const provider = createOpenAIEmbeddingProvider('sk-test', {}, client)
    const texts = Array.from({ length: 600 }, (_, i) => 'x'.repeat(i + 1))

    const out = await provider.generateEmbeddings(texts)

    expect(client.embeddings.create).toHaveBeenCalledTimes(3) // 256 + 256 + 88
    expect(out).toHaveLength(600)
    expect(out[0]).toEqual([1])
    expect(out[299]).toEqual([300])
    expect(out[599]).toEqual([600])
  })

  it('truncates each text like the single-text method', async () => {
    const client = makeClient()
    const provider = createOpenAIEmbeddingProvider('sk-test', {}, client)

    await provider.generateEmbeddings(['x'.repeat(20000)])

    expect(client.embeddings.create.mock.calls[0][0].input[0].length).toBe(8000)
  })

  it('records the real token usage once per request', async () => {
    const client = makeClient()
    const onUsage = vi.fn()
    const provider = createOpenAIEmbeddingProvider('sk-test', {}, client, onUsage)

    await provider.generateEmbeddings(Array.from({ length: 300 }, () => 'a'))

    expect(onUsage).toHaveBeenCalledTimes(2)
    expect(onUsage.mock.calls[0][0]).toMatchObject({ action_type: 'embedding', provider: 'openai', prompt_tokens: 2560 })
    expect(onUsage.mock.calls[1][0]).toMatchObject({ prompt_tokens: 440 })
  })

  it('reports (done, total) after each request so the UI can draw a progress bar', async () => {
    const client = makeClient()
    const provider = createOpenAIEmbeddingProvider('sk-test', {}, client)
    const onProgress = vi.fn()

    await provider.generateEmbeddings(Array.from({ length: 600 }, () => 'a'), onProgress)

    expect(onProgress.mock.calls).toEqual([[256, 600], [512, 600], [600, 600]])
  })

  it('returns [] without calling the API for an empty list', async () => {
    const client = makeClient()
    const provider = createOpenAIEmbeddingProvider('sk-test', {}, client)

    expect(await provider.generateEmbeddings([])).toEqual([])
    expect(client.embeddings.create).not.toHaveBeenCalled()
  })
})
