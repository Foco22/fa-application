import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import { cosineSimilarity, indexReferenceFolder, indexFiles, scoreAbstractAgainst, scoreEmbeddingAgainst, embedKeywordList, createEmbeddings, hasEmbeddingConfig } from '../../../src/embeddings/index.js'

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

  it('uses embeddingApiKey over openaiApiKey and apiKey when all three are set', () => {
    const provider = createEmbeddings({ apiKey: 'fallback', openaiApiKey: 'primary', embeddingApiKey: 'dedicated' })
    expect(typeof provider.generateEmbedding).toBe('function')
  })

  it('tags the openai provider with an id that names the model', () => {
    const provider = createEmbeddings({ apiKey: 'sk-test' })
    expect(provider.id).toBe('openai:text-embedding-3-small')
  })

  it('honours embeddingModel in the openai provider id', () => {
    const provider = createEmbeddings({ apiKey: 'sk-test', embeddingModel: 'text-embedding-3-large' })
    expect(provider.id).toBe('openai:text-embedding-3-large')
  })

  it('returns the local provider when embeddingProvider is "local", with no apiKey at all', () => {
    const provider = createEmbeddings({ embeddingProvider: 'local' })
    expect(typeof provider.generateEmbedding).toBe('function')
    expect(provider.id).toBe('local:Xenova/all-MiniLM-L6-v2')
  })

  it('honours embeddingModel for the local provider', () => {
    const provider = createEmbeddings({ embeddingProvider: 'local', embeddingModel: 'Xenova/bge-small-en-v1.5' })
    expect(provider.id).toBe('local:Xenova/bge-small-en-v1.5')
  })
})

// ─── hasEmbeddingConfig ───────────────────────────────────────────────────────

describe('hasEmbeddingConfig', () => {
  it('is false for openai without any key — nothing to embed with', () => {
    expect(hasEmbeddingConfig({ embeddingProvider: 'openai' })).toBe(false)
    expect(hasEmbeddingConfig({})).toBe(false)
  })

  it('is true for openai as soon as any usable key is present', () => {
    expect(hasEmbeddingConfig({ apiKey: 'sk-test' })).toBe(true)
    expect(hasEmbeddingConfig({ openaiApiKey: 'sk-test' })).toBe(true)
    expect(hasEmbeddingConfig({ embeddingApiKey: 'sk-test' })).toBe(true)
  })

  it('is true for the local provider even with no keys — it runs offline', () => {
    expect(hasEmbeddingConfig({ embeddingProvider: 'local' })).toBe(true)
  })
})

// ─── shared mocks ─────────────────────────────────────────────────────────────

function makeProvider(embedding = [0.1, 0.2, 0.3]) {
  return { id: 'openai:text-embedding-3-small', generateEmbedding: vi.fn().mockResolvedValue(embedding) }
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

  // Vectores de modelos distintos no son comparables (ni siquiera comparten
  // dimensión), así que cada referencia guarda con qué proveedor:modelo se
  // generó — es lo que permite descartar el índice viejo al cambiar de motor.
  it('stamps each stored reference with the provider id that embedded it', async () => {
    const db       = makeDb()
    const provider = { id: 'local:Xenova/all-MiniLM-L6-v2', generateEmbedding: vi.fn().mockResolvedValue([0.1]) }
    await indexReferenceFolder('/refs', db, provider, makePdfParse())
    expect(db.saveReferencePaper).toHaveBeenCalledWith(
      expect.objectContaining({ embedding_model: 'local:Xenova/all-MiniLM-L6-v2' })
    )
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

  it('saves null abstract_summary when no llm is provided', async () => {
    const db = makeDb()
    await indexReferenceFolder('/refs', db, makeProvider(), makePdfParse())
    expect(db.saveReferencePaper).toHaveBeenCalledWith(
      expect.objectContaining({ abstract_summary: null })
    )
  })

  it('generates and saves abstract_summary when an llm is provided', async () => {
    const db  = makeDb()
    const llm = { summarizeAbstract: vi.fn().mockResolvedValue('A short summary.') }
    await indexReferenceFolder('/refs', db, makeProvider(), makePdfParse('some snippet text'), llm)
    expect(llm.summarizeAbstract).toHaveBeenCalledWith('some snippet text')
    expect(db.saveReferencePaper).toHaveBeenCalledWith(
      expect.objectContaining({ abstract_summary: 'A short summary.' })
    )
  })
})

// ─── indexFiles ───────────────────────────────────────────────────────────────

describe('indexFiles', () => {
  it('stamps each stored reference with the provider id that embedded it', async () => {
    const db       = makeDb()
    const provider = { id: 'local:Xenova/all-MiniLM-L6-v2', generateEmbedding: vi.fn().mockResolvedValue([0.1]) }
    await indexFiles(['/docs/paper.pdf'], db, provider, makePdfParse())
    expect(db.saveReferencePaper).toHaveBeenCalledWith(
      expect.objectContaining({ embedding_model: 'local:Xenova/all-MiniLM-L6-v2' })
    )
  })

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

  it('generates and saves abstract_summary when an llm is provided', async () => {
    const db  = makeDb()
    const llm = { summarizeAbstract: vi.fn().mockResolvedValue('Short summary.') }
    await indexFiles(['/docs/paper.pdf'], db, makeProvider(), makePdfParse('snippet text'), llm)
    expect(llm.summarizeAbstract).toHaveBeenCalledWith('snippet text')
    expect(db.saveReferencePaper).toHaveBeenCalledWith(
      expect.objectContaining({ abstract_summary: 'Short summary.' })
    )
  })

  it('saves null abstract_summary when no llm is provided', async () => {
    const db = makeDb()
    await indexFiles(['/docs/paper.pdf'], db, makeProvider(), makePdfParse())
    expect(db.saveReferencePaper).toHaveBeenCalledWith(
      expect.objectContaining({ abstract_summary: null })
    )
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

// ─── scoreEmbeddingAgainst ────────────────────────────────────────────────────

describe('scoreEmbeddingAgainst', () => {
  it('returns the maximum cosine similarity across all reference embeddings', () => {
    const score = scoreEmbeddingAgainst([1, 0], [[0, 1], [1, 0], [0.5, 0.5]])
    expect(score).toBeCloseTo(1.0)
  })

  it('returns 0 when the reference list is empty', () => {
    expect(scoreEmbeddingAgainst([1, 0], [])).toBe(0)
  })

  it('does not call any embedding provider (pure function)', () => {
    // no provider argument at all — this must work on precomputed vectors only
    expect(() => scoreEmbeddingAgainst([1, 0], [[1, 0]])).not.toThrow()
  })
})

// ─── embedKeywordList ─────────────────────────────────────────────────────────

describe('embedKeywordList', () => {
  it('returns [] for an empty or blank keywordList', async () => {
    expect(await embedKeywordList('', makeProvider())).toEqual([])
    expect(await embedKeywordList('   \n  ', makeProvider())).toEqual([])
  })

  it('embeds each non-blank line as its own keyword', async () => {
    const provider = makeProvider([0.1, 0.2])
    await embedKeywordList('diffusion models\ncausal inference', provider)
    expect(provider.generateEmbedding).toHaveBeenCalledTimes(2)
    expect(provider.generateEmbedding).toHaveBeenCalledWith('diffusion models')
    expect(provider.generateEmbedding).toHaveBeenCalledWith('causal inference')
  })

  it('returns { keyword, embedding } pairs', async () => {
    const embedding = [0.1, 0.2, 0.3]
    const result = await embedKeywordList('diffusion models', makeProvider(embedding))
    expect(result).toEqual([{ keyword: 'diffusion models', embedding }])
  })

  it('ignores blank lines', async () => {
    const provider = makeProvider()
    const result = await embedKeywordList('diffusion models\n\n\ncausal inference\n', provider)
    expect(result).toHaveLength(2)
  })

  it('never calls the provider when there are no keywords', async () => {
    const provider = makeProvider()
    await embedKeywordList('', provider)
    expect(provider.generateEmbedding).not.toHaveBeenCalled()
  })
})
