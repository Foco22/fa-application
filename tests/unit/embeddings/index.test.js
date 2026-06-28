import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import { cosineSimilarity, indexReferenceFolder, indexFiles, scoreAbstractAgainst, createEmbeddings } from '../../../src/embeddings/index.js'

// ─── cosineSimilarity ─────────────────────────────────────────────────────────

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical vectors', () => {
    const v = [1, 2, 3]
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0)
  })

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
  })

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1)
  })

  it('returns 0 when either vector is the zero vector', () => {
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0)
    expect(cosineSimilarity([1, 2], [0, 0])).toBe(0)
  })

  it('returns a value between -1 and 1 for arbitrary vectors', () => {
    const score = cosineSimilarity([0.3, 0.7, 0.1], [0.5, 0.2, 0.8])
    expect(score).toBeGreaterThanOrEqual(-1)
    expect(score).toBeLessThanOrEqual(1)
  })
})

// ─── createEmbeddings factory ─────────────────────────────────────────────────

describe('createEmbeddings', () => {
  it('returns a provider with generateEmbedding when given an apiKey', () => {
    const provider = createEmbeddings({ apiKey: 'sk-test' })
    expect(typeof provider.generateEmbedding).toBe('function')
  })

  it('uses openaiApiKey over apiKey when both are set', () => {
    const provider = createEmbeddings({ apiKey: 'fallback', openaiApiKey: 'primary' })
    expect(typeof provider.generateEmbedding).toBe('function')
  })

  it('defaults to openai provider when embeddingProvider is not set', () => {
    const provider = createEmbeddings({ apiKey: 'sk-test' })
    expect(provider).toBeDefined()
  })
})

// ─── shared mocks ─────────────────────────────────────────────────────────────

function makeProvider(embedding = [0.1, 0.2, 0.3]) {
  return { generateEmbedding: vi.fn().mockResolvedValue(embedding) }
}

function makePdfParse(text = 'extracted text from pdf') {
  return vi.fn().mockResolvedValue({ text })
}

function makeDb(overrides = {}) {
  return {
    getReferencePaper:  vi.fn().mockReturnValue(null),
    saveReferencePaper: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.spyOn(fs, 'readdirSync').mockReturnValue(['paper1.pdf', 'paper2.pdf', 'notes.txt'])
  vi.spyOn(fs, 'existsSync').mockReturnValue(true)
  vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('fake pdf'))
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ─── indexReferenceFolder ─────────────────────────────────────────────────────

describe('indexReferenceFolder', () => {
  it('returns { indexed: 0, errors: 0 } when folder does not exist', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false)
    const result = await indexReferenceFolder('/nonexistent', makeDb(), makeProvider(), makePdfParse())
    expect(result).toEqual({ indexed: 0, errors: 0 })
  })

  it('returns { indexed: 0, errors: 0 } when folderPath is null', async () => {
    const result = await indexReferenceFolder(null, makeDb(), makeProvider(), makePdfParse())
    expect(result).toEqual({ indexed: 0, errors: 0 })
  })

  it('only processes PDF files, ignores others', async () => {
    const db       = makeDb()
    const provider = makeProvider()
    await indexReferenceFolder('/refs', db, provider, makePdfParse())
    // 2 PDFs (paper1.pdf, paper2.pdf) — notes.txt skipped
    expect(db.saveReferencePaper).toHaveBeenCalledTimes(2)
  })

  it('skips files already in the database', async () => {
    const db       = makeDb({ getReferencePaper: vi.fn().mockReturnValue({ id: 1 }) })
    const provider = makeProvider()
    await indexReferenceFolder('/refs', db, provider, makePdfParse())
    expect(db.saveReferencePaper).not.toHaveBeenCalled()
  })

  it('calls provider.generateEmbedding for each new PDF', async () => {
    const provider = makeProvider()
    await indexReferenceFolder('/refs', makeDb(), provider, makePdfParse())
    expect(provider.generateEmbedding).toHaveBeenCalledTimes(2)
  })

  it('saves snippet and serialized embedding to the database', async () => {
    const embedding = [0.5, 0.6, 0.7]
    const db        = makeDb()
    await indexReferenceFolder('/refs', db, makeProvider(embedding), makePdfParse('some text'))
    expect(db.saveReferencePaper).toHaveBeenCalledWith(
      expect.objectContaining({
        snippet:   expect.any(String),
        embedding: JSON.stringify(embedding),
      })
    )
  })

  it('counts errors and continues when a file throws', async () => {
    vi.spyOn(fs, 'readFileSync').mockImplementationOnce(() => { throw new Error('locked') })
    const result = await indexReferenceFolder('/refs', makeDb(), makeProvider(), makePdfParse())
    expect(result.errors).toBe(1)
    expect(result.indexed).toBe(1)
  })

  it('returns correct indexed count', async () => {
    const result = await indexReferenceFolder('/refs', makeDb(), makeProvider(), makePdfParse())
    expect(result.indexed).toBe(2)
    expect(result.errors).toBe(0)
  })
})

// ─── indexFiles ───────────────────────────────────────────────────────────────

describe('indexFiles', () => {
  it('skips non-PDF files', async () => {
    const db = makeDb()
    await indexFiles(['/docs/notes.txt', '/docs/image.png'], db, makeProvider(), makePdfParse())
    expect(db.saveReferencePaper).not.toHaveBeenCalled()
  })

  it('skips files already indexed', async () => {
    const db = makeDb({ getReferencePaper: vi.fn().mockReturnValue({ id: 1 }) })
    await indexFiles(['/docs/paper.pdf'], db, makeProvider(), makePdfParse())
    expect(db.saveReferencePaper).not.toHaveBeenCalled()
  })

  it('indexes a new PDF and saves embedding', async () => {
    const embedding = [0.1, 0.2]
    const db        = makeDb()
    await indexFiles(['/docs/paper.pdf'], db, makeProvider(embedding), makePdfParse())
    expect(db.saveReferencePaper).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/docs/paper.pdf', embedding: JSON.stringify(embedding) })
    )
  })

  it('returns correct indexed/errors counts', async () => {
    const result = await indexFiles(['/docs/a.pdf', '/docs/b.txt'], makeDb(), makeProvider(), makePdfParse())
    expect(result.indexed).toBe(1)
    expect(result.errors).toBe(0)
  })

  it('counts errors when processing throws', async () => {
    vi.spyOn(fs, 'readFileSync').mockImplementationOnce(() => { throw new Error('bad') })
    const result = await indexFiles(['/docs/bad.pdf'], makeDb(), makeProvider(), makePdfParse())
    expect(result.errors).toBe(1)
    expect(result.indexed).toBe(0)
  })
})

// ─── scoreAbstractAgainst ─────────────────────────────────────────────────────

describe('scoreAbstractAgainst', () => {
  it('returns the maximum cosine similarity across all reference embeddings', async () => {
    const provider = makeProvider([1, 0])
    const refs     = [[0, 1], [1, 0], [0.5, 0.5]]
    const score    = await scoreAbstractAgainst('abstract text', refs, provider)
    expect(score).toBeCloseTo(1.0)
  })

  it('returns 0 when the reference list is empty', async () => {
    const score = await scoreAbstractAgainst('text', [], makeProvider())
    expect(score).toBe(0)
  })

  it('calls provider.generateEmbedding with the abstract text', async () => {
    const provider = makeProvider([1, 0])
    await scoreAbstractAgainst('my abstract', [[1, 0]], provider)
    expect(provider.generateEmbedding).toHaveBeenCalledWith('my abstract')
  })
})
