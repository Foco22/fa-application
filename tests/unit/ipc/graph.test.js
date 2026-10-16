import path from 'path'
import { describe, it, expect, vi } from 'vitest'
import { registerGraphHandlers } from '../../../src/ipc/graph.js'
import { hasEmbeddingConfig } from '../../../src/embeddings/index.js'

const MODEL = 'openai:text-embedding-3-small'

const paper = (id, extra = {}) => ({
  id, title: `Title ${id}`, abstract: `Abstract of ${id}`, created_at: '2026-10-12 10:00:00',
  published_date: '2026-10-09', summary: null, ...extra,
})

const ref = (name, embedding, model = MODEL) => ({
  path: path.join('refs', `${name}.pdf`), embedding: JSON.stringify(embedding), embedding_model: model,
})

function setup({ papers = [], refs = [], stored = [], settings = {}, embed } = {}) {
  const handlers = {}
  const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn } }

  const db = {
    getAllSettings: vi.fn().mockReturnValue({ apiKey: 'sk', embeddingProvider: 'openai', ...settings }),
    getPapers: vi.fn().mockReturnValue(papers),
    getPaper: vi.fn().mockImplementation(id => papers.find(p => p.id === id) ?? null),
    getReferencePapers: vi.fn().mockReturnValue(refs),
    getPaperEmbeddings: vi.fn().mockReturnValue(stored),
    savePaperEmbedding: vi.fn(),
  }

  const provider = {
    id: MODEL,
    generateEmbedding: embed ?? vi.fn().mockImplementation(async text => {
      const h = [...text].reduce((a, c) => a + c.charCodeAt(0), 0)
      return [Math.sin(h), Math.cos(h), 0.5]
    }),
  }

  const deps = { createEmbeddings: vi.fn().mockReturnValue(provider), hasEmbeddingConfig }
  registerGraphHandlers({ ipcMain, db, deps })
  return { call: (args) => handlers['get-graph']({}, args), db, provider, deps }
}

describe('get-graph', () => {
  it('returns an error when no embedding provider is configured', async () => {
    const { call } = setup({ settings: { apiKey: '', openaiApiKey: '', embeddingApiKey: '' } })
    expect(await call()).toEqual({ error: 'no-embeddings' })
  })

  it('has nodes for the references and for the weekly papers, nothing else', async () => {
    const { call } = setup({
      papers: [paper('2410.1'), paper('2410.2')],
      refs: [ref('alpha', [1, 0, 0]), ref('beta', [0, 1, 0])],
    })
    const g = await call()
    const kinds = g.nodes.map(n => n.kind).sort()
    expect(kinds).toEqual(['paper', 'paper', 'reference', 'reference'])
  })

  it('does not duplicate references that also live in the papers table (ref-* ids)', async () => {
    const { call } = setup({
      papers: [paper('ref-alpha', { title: 'Alpha Title' }), paper('2410.1')],
      refs: [ref('alpha', [1, 0, 0])],
    })
    const g = await call()
    expect(g.nodes).toHaveLength(2)
    const r = g.nodes.find(n => n.kind === 'reference')
    expect(r.title).toBe('Alpha Title')
  })

  it('reuses stored paper embeddings and only embeds the ones missing', async () => {
    const { call, provider, db } = setup({
      papers: [paper('2410.1'), paper('2410.2')],
      stored: [{ paper_id: '2410.1', embedding: [1, 0, 0], model: MODEL }],
    })
    await call()
    expect(provider.generateEmbedding).toHaveBeenCalledTimes(1)
    expect(provider.generateEmbedding).toHaveBeenCalledWith('Abstract of 2410.2')
    expect(db.savePaperEmbedding).toHaveBeenCalledWith('2410.2', expect.any(Array), MODEL)
  })

  it('re-embeds a paper whose stored embedding comes from another model', async () => {
    const { call, provider } = setup({
      papers: [paper('2410.1')],
      stored: [{ paper_id: '2410.1', embedding: [1, 0], model: 'local:other' }],
    })
    await call()
    expect(provider.generateEmbedding).toHaveBeenCalledTimes(1)
  })

  it('flags references indexed with another model as stale instead of mixing them', async () => {
    const { call } = setup({
      papers: [paper('2410.1'), paper('2410.2')],
      refs: [ref('old', [1, 0], 'local:other')],
    })
    const g = await call()
    expect(g.stale).toEqual(['ref:' + path.join('refs', 'old.pdf')])
    expect(g.nodes.some(n => n.kind === 'reference')).toBe(false)
  })

  it('reports papers it could not embed as missing and still returns the rest', async () => {
    const embed = vi.fn()
      .mockResolvedValueOnce([1, 0, 0])
      .mockRejectedValueOnce(new Error('rate limit'))
    const { call } = setup({ papers: [paper('a'), paper('b'), paper('c')], embed })
    const g = await call()
    expect(g.missing.length).toBeGreaterThan(0)
    expect(g.nodes.length).toBeGreaterThan(0)
  })

  it('skips papers without an abstract', async () => {
    const { call, provider } = setup({ papers: [paper('a', { abstract: '' }), paper('b')] })
    await call()
    expect(provider.generateEmbedding).toHaveBeenCalledTimes(1)
  })

  it('returns edges, community ids per node and quality metrics without the n×n matrix', async () => {
    const { call } = setup({
      refs: [ref('a', [1, 0.1, 0]), ref('b', [1, 0.2, 0]), ref('c', [-1, 0.1, 0]), ref('d', [-1, 0.2, 0])],
    })
    const g = await call({ k: 1 })
    expect(g.edges.length).toBeGreaterThan(0)
    expect(g.nodes.every(n => Number.isInteger(n.community))).toBe(true)
    expect(g.metrics.structure.isolated).toBe(0)
    expect(g.similarity).toBeUndefined()
    expect(g.model).toBe(MODEL)
  })

  it('passes k to the edge builder', async () => {
    const refs = [1, 2, 3, 4, 5].map(i => ref(`r${i}`, [Math.cos(i), Math.sin(i), 0.3]))
    const { call } = setup({ refs })
    const few  = await call({ k: 1 })
    const many = await call({ k: 4 })
    expect(many.edges.length).toBeGreaterThan(few.edges.length)
  })

  it('shortens abstracts and keeps only what the renderer needs', async () => {
    const { call } = setup({ papers: [paper('a', { abstract: 'x'.repeat(2000), pdf_text: 'huge', summary: 'S' })] })
    const g = await call()
    const n = g.nodes[0]
    expect(n.abstract.length).toBeLessThanOrEqual(600)
    expect(n.pdf_text).toBeUndefined()
    expect(n.hasSummary).toBe(true)
  })
})

describe('get-graph — community labels', () => {
  it('returns a named entry per community so the UI can explain the colors', async () => {
    const refs = [
      { name: 'a', v: [1, 0.1, 0], t: 'Sparse mixture of experts routing' },
      { name: 'b', v: [1, 0.2, 0], t: 'Expert capacity in mixture of experts' },
      { name: 'c', v: [-1, 0.1, 0], t: 'Diffusion sampler for images' },
      { name: 'd', v: [-1, 0.2, 0], t: 'Fast diffusion image sampling' },
    ]
    const { call } = setup({
      refs: refs.map(r => ref(r.name, r.v)),
      papers: refs.map(r => paper(`ref-${r.name}`, { title: r.t, abstract: r.t })),
    })
    const g = await call({ k: 1 })

    expect(g.communities.length).toBeGreaterThanOrEqual(2)
    const ids = new Set(g.nodes.map(n => n.community))
    expect(g.communities.map(c => c.id).sort()).toEqual([...ids].sort())
    expect(g.communities.every(c => typeof c.label === 'string' && c.size > 0)).toBe(true)
    const text = g.communities.map(c => c.label).join(' ')
    expect(text).toMatch(/expert/)
    expect(text).toMatch(/diffusion/)
  })
})
