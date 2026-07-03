import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import { runFetch, selectCandidates, PRERANK_CAP } from '../../../src/ipc/papers.js'
import { scoreEmbeddingAgainst } from '../../../src/embeddings/index.js'
import { extractKeywords, keywordOverlap } from '../../../src/ingestion/keywords.js'

// ─── shared fixtures ──────────────────────────────────────────────────────────

const PAPER = {
  id: '2401.00001',
  title: 'Test Paper',
  authors: 'Alice',
  abstract: 'A paper about AI.',
  pdf_url: 'https://arxiv.org/pdf/2401.00001',
  published_date: '2024-01-09',
}

const SETTINGS = {
  apiKey: 'sk-test',
  maxPapers: '3',
  similarityThreshold: '0.6',
  universityList: 'MIT\nStanford',
  researchCenterList: '',
  semanticScholarApiKey: '',
  categoryList: 'cs.AI',
  keywordList: '',
}

// ─── context factory ──────────────────────────────────────────────────────────

function makeCtx(overrides = {}) {
  const db = {
    getAllSettings:    vi.fn().mockReturnValue({ ...SETTINGS, ...overrides.settings }),
    getReferencePapers: vi.fn().mockReturnValue([]),
    savePaper:        vi.fn(),
    ...overrides.db,
  }

  const mockLLM = {
    extractAffiliationsWithAI: vi.fn().mockResolvedValue(['MIT']),
    ...overrides.llm,
  }

  const mockEmbProvider = { generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2]) }

  const deps = {
    createLLM:             vi.fn().mockReturnValue(mockLLM),
    createEmbeddings:      vi.fn().mockReturnValue(mockEmbProvider),
    createReranker:        vi.fn().mockReturnValue({
      rerank: vi.fn().mockImplementation(async (_query, documents) =>
        documents.map((_, index) => ({ index, score: 1 - index * 0.01 }))
      ),
    }),
    scoreEmbeddingAgainst: scoreEmbeddingAgainst,
    embedKeywordList:      vi.fn().mockResolvedValue([]),
    extractKeywords:       extractKeywords,
    keywordOverlap:        keywordOverlap,
    fetchPapers:           vi.fn().mockResolvedValue([{ ...PAPER }]),
    getAffiliations:       vi.fn().mockResolvedValue(null),
    downloadPdf:           vi.fn().mockResolvedValue({ success: true, path: '/tmp/2401.00001.pdf' }),
    extractFirstPage:      vi.fn().mockResolvedValue({ success: true, text: 'first page MIT' }),
    extractText:           vi.fn().mockResolvedValue({ success: true, text: 'full text' }),
    matchesUniversityInText: vi.fn().mockReturnValue(true),
    httpClient:            {},
    pdfParse:              vi.fn(),
    vault: {
      ensureDirs: vi.fn(),
      pdfPath:    vi.fn().mockReturnValue('/vault/2401.00001/raw/2401.00001.pdf'),
      deletePaperDir: vi.fn(),
    },
    ...overrides.deps,
  }

  const mainWindow = { webContents: { send: vi.fn() }, ...overrides.mainWindow }

  return { db, deps, mainWindow }
}

// ─── setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('fake pdf'))
  vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {})
  vi.spyOn(fs, 'existsSync').mockReturnValue(false)
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ─── fetchPapers error ────────────────────────────────────────────────────────

describe('runFetch — fetchPapers error', () => {
  it('returns the error immediately without saving anything', async () => {
    const { db, deps, mainWindow } = makeCtx({
      deps: { fetchPapers: vi.fn().mockResolvedValue({ error: 'No categories configured' }) }
    })

    const result = await runFetch({ db, deps, mainWindow })

    expect(result).toEqual({ error: 'No categories configured' })
    expect(db.savePaper).not.toHaveBeenCalled()
  })
})

// ─── selection phase: no interest signal configured ───────────────────────────

describe('runFetch — selection phase: no interest signal', () => {
  it('skips filtering entirely when there is no reference collection and no keywordList', async () => {
    const { db, deps, mainWindow } = makeCtx()

    await runFetch({ db, deps, mainWindow })

    expect(deps.createEmbeddings().generateEmbedding).not.toHaveBeenCalled()
    expect(deps.createReranker).not.toHaveBeenCalled()
    expect(db.savePaper).toHaveBeenCalledOnce()
  })
})

// ─── selection phase: reference collection (embedding + keyword) ─────────────

describe('runFetch — selection phase: reference collection', () => {
  it('rejects when embedding similarity is below threshold and no keyword overlaps', async () => {
    const { db, deps, mainWindow } = makeCtx({
      db: { getReferencePapers: vi.fn().mockReturnValue([
        { embedding: '[1,0]', snippet: 'unrelated content here', abstract_summary: 'A summary about biology.' }
      ]) },
      deps: { createEmbeddings: vi.fn().mockReturnValue({ generateEmbedding: vi.fn().mockResolvedValue([0, 1]) }) },
    })

    await runFetch({ db, deps, mainWindow })

    expect(db.savePaper).not.toHaveBeenCalled()
  })

  it('accepts when embedding similarity meets threshold', async () => {
    const { db, deps, mainWindow } = makeCtx({
      db: { getReferencePapers: vi.fn().mockReturnValue([
        { embedding: '[1,0]', snippet: '', abstract_summary: 'A summary about AI.' }
      ]) },
      deps: { createEmbeddings: vi.fn().mockReturnValue({ generateEmbedding: vi.fn().mockResolvedValue([1, 0]) }) },
    })

    await runFetch({ db, deps, mainWindow })

    expect(db.savePaper).toHaveBeenCalledOnce()
  })

  it('accepts via literal keyword overlap even when embedding similarity is low', async () => {
    const { db, deps, mainWindow } = makeCtx({
      db: { getReferencePapers: vi.fn().mockReturnValue([
        { embedding: '[1,0]', snippet: 'we look at ai and other systems.', abstract_summary: 'A summary.' }
      ]) },
      deps: { createEmbeddings: vi.fn().mockReturnValue({ generateEmbedding: vi.fn().mockResolvedValue([0, 1]) }) },
    })
    // "ai" is extracted as its own keyword from the reference snippet and
    // literally appears in PAPER.abstract ("A paper about AI.")

    await runFetch({ db, deps, mainWindow })

    expect(db.savePaper).toHaveBeenCalledOnce()
  })

  it('aborts the whole fetch when the embeddings API throws, surfacing the real error message', async () => {
    const { db, deps, mainWindow } = makeCtx({
      db: { getReferencePapers: vi.fn().mockReturnValue([{ embedding: '[1,0]', snippet: '', abstract_summary: 'x' }]) },
      deps: { createEmbeddings: vi.fn().mockReturnValue({ generateEmbedding: vi.fn().mockRejectedValue(new Error('invalid key')) }) },
    })

    const result = await runFetch({ db, deps, mainWindow })

    // must include the actual thrown message, not just a generic guess —
    // a misleading fixed message here once masked an unrelated bug (rerank)
    expect(result.error).toContain('invalid key')
    expect(result.error).toContain('API key')
    expect(db.savePaper).not.toHaveBeenCalled()
  })

  it('skips embedding signals (but not keyword signals) when there is no apiKey', async () => {
    const { db, deps, mainWindow } = makeCtx({
      settings: { apiKey: '' },
      db: { getReferencePapers: vi.fn().mockReturnValue([
        { embedding: '[1,0]', snippet: 'we look at ai and other systems.', abstract_summary: 'x' }
      ]) },
    })

    await runFetch({ db, deps, mainWindow })

    // no apiKey → no embedding provider → literal keyword overlap ("ai") still lets it through
    expect(db.savePaper).toHaveBeenCalledOnce()
  })
})

// ─── selection phase: declared keywordList (interest signal) ─────────────────

describe('runFetch — selection phase: keywordList', () => {
  it('accepts via embedding similarity against a declared keyword', async () => {
    const { db, deps, mainWindow } = makeCtx({
      settings: { keywordList: 'artificial intelligence' },
      deps: {
        embedKeywordList: vi.fn().mockResolvedValue([{ keyword: 'artificial intelligence', embedding: [1, 0] }]),
        createEmbeddings: vi.fn().mockReturnValue({ generateEmbedding: vi.fn().mockResolvedValue([1, 0]) }),
      },
    })

    await runFetch({ db, deps, mainWindow })

    expect(db.savePaper).toHaveBeenCalledOnce()
  })

  it('accepts via literal overlap of a declared keyword', async () => {
    const { db, deps, mainWindow } = makeCtx({
      settings: { keywordList: 'ai' },
    })
    // PAPER.abstract "A paper about AI." contains "ai" case-insensitively

    await runFetch({ db, deps, mainWindow })

    expect(db.savePaper).toHaveBeenCalledOnce()
  })

  it('rejects when neither embedding nor keyword overlap match the declared interest', async () => {
    const { db, deps, mainWindow } = makeCtx({
      settings: { keywordList: 'marine biology' },
      deps: {
        embedKeywordList: vi.fn().mockResolvedValue([{ keyword: 'marine biology', embedding: [0, 1] }]),
        createEmbeddings: vi.fn().mockReturnValue({ generateEmbedding: vi.fn().mockResolvedValue([1, 0]) }),
      },
    })

    await runFetch({ db, deps, mainWindow })

    expect(db.savePaper).not.toHaveBeenCalled()
  })
})

// ─── pre-rank cap + rerank ─────────────────────────────────────────────────────

describe('selectCandidates — pre-rank cap and rerank', () => {
  function makeCandidates(n) {
    return Array.from({ length: n }, (_, i) => ({ ...PAPER, id: `p${i}`, abstract: `abstract ${i} about ai` }))
  }

  it('caps the candidates handed to the reranker at PRERANK_CAP', async () => {
    const candidates = makeCandidates(30)
    const db = { getReferencePapers: vi.fn().mockReturnValue([{ embedding: '[1,0]', snippet: '', abstract_summary: 'profile' }]) }
    const rerankSpy = vi.fn().mockImplementation(async (_q, docs) => docs.map((_, index) => ({ index, score: 1 })))
    const deps = {
      scoreEmbeddingAgainst,
      embedKeywordList: vi.fn().mockResolvedValue([]),
      extractKeywords,
      keywordOverlap,
      createReranker: vi.fn().mockReturnValue({ rerank: rerankSpy }),
    }
    const embProvider = { generateEmbedding: vi.fn().mockResolvedValue([1, 0]) } // matches ref → all 30 pass

    await selectCandidates(candidates, { db, deps, settings: { ...SETTINGS }, embProvider, similarityThreshold: 0.6 })

    expect(rerankSpy).toHaveBeenCalledOnce()
    expect(rerankSpy.mock.calls[0][1]).toHaveLength(PRERANK_CAP)
  })

  it('orders survivors according to the reranker score, not the original order', async () => {
    const candidates = makeCandidates(3)
    const db = { getReferencePapers: vi.fn().mockReturnValue([{ embedding: '[1,0]', snippet: '', abstract_summary: 'profile' }]) }
    // reranker says the LAST candidate (index 2) is actually the best match
    const rerankSpy = vi.fn().mockResolvedValue([{ index: 2, score: 0.9 }, { index: 0, score: 0.5 }, { index: 1, score: 0.1 }])
    const deps = {
      scoreEmbeddingAgainst,
      embedKeywordList: vi.fn().mockResolvedValue([]),
      extractKeywords,
      keywordOverlap,
      createReranker: vi.fn().mockReturnValue({ rerank: rerankSpy }),
    }
    const embProvider = { generateEmbedding: vi.fn().mockResolvedValue([1, 0]) }

    const { survivors } = await selectCandidates(candidates, { db, deps, settings: { ...SETTINGS }, embProvider, similarityThreshold: 0.6 })

    expect(survivors.map(p => p.id)).toEqual(['p2', 'p0', 'p1'])
  })

  it('skips rerank and returns filtered candidates unranked when there is no rerank query', async () => {
    // no reference abstract_summary, no keywordList → rerankQuery is empty even though a
    // reference embedding exists (edge case: paper was indexed before abstract_summary existed)
    const candidates = makeCandidates(2)
    const db = { getReferencePapers: vi.fn().mockReturnValue([{ embedding: '[1,0]', snippet: '', abstract_summary: null }]) }
    const createReranker = vi.fn()
    const deps = {
      scoreEmbeddingAgainst,
      embedKeywordList: vi.fn().mockResolvedValue([]),
      extractKeywords,
      keywordOverlap,
      createReranker,
    }
    const embProvider = { generateEmbedding: vi.fn().mockResolvedValue([1, 0]) }

    const { survivors } = await selectCandidates(candidates, { db, deps, settings: { ...SETTINGS }, embProvider, similarityThreshold: 0.6 })

    expect(createReranker).not.toHaveBeenCalled()
    expect(survivors).toHaveLength(2)
  })
})

// ─── PDF download failure ─────────────────────────────────────────────────────

describe('runFetch — PDF download failure', () => {
  it('skips the paper and does not save it', async () => {
    const { db, deps, mainWindow } = makeCtx({
      deps: { downloadPdf: vi.fn().mockResolvedValue({ success: false, error: 'timeout' }) }
    })

    await runFetch({ db, deps, mainWindow })

    expect(db.savePaper).not.toHaveBeenCalled()
  })
})

// ─── org filter ───────────────────────────────────────────────────────────────

describe('runFetch — org filter', () => {
  it('rejects paper and deletes PDF when AI affiliations do not match', async () => {
    const { db, deps, mainWindow } = makeCtx({
      llm: { extractAffiliationsWithAI: vi.fn().mockResolvedValue(['Harvard']) },
    })

    await runFetch({ db, deps, mainWindow })

    expect(fs.unlinkSync).toHaveBeenCalledWith('/tmp/2401.00001.pdf')
    expect(db.savePaper).not.toHaveBeenCalled()
  })

  it('accepts paper when AI affiliation matches org filter', async () => {
    const { db, deps, mainWindow } = makeCtx({
      llm: { extractAffiliationsWithAI: vi.fn().mockResolvedValue(['Stanford University']) },
    })

    await runFetch({ db, deps, mainWindow })

    expect(db.savePaper).toHaveBeenCalledOnce()
  })

  it('passes when org filter is empty regardless of affiliations', async () => {
    const { db, deps, mainWindow } = makeCtx({
      settings: { universityList: '', researchCenterList: '' },
      llm:      { extractAffiliationsWithAI: vi.fn().mockResolvedValue(['Unknown University']) },
    })

    await runFetch({ db, deps, mainWindow })

    expect(db.savePaper).toHaveBeenCalledOnce()
  })

  it('falls back to matchesUniversityInText when no LLM is available', async () => {
    const { db, deps, mainWindow } = makeCtx({
      settings: { apiKey: '' },
    })

    await runFetch({ db, deps, mainWindow })

    expect(deps.matchesUniversityInText).toHaveBeenCalledWith('first page MIT', ['MIT', 'Stanford'])
  })

  it('rejects via matchesUniversityInText fallback when it returns false', async () => {
    const { db, deps, mainWindow } = makeCtx({
      settings: { apiKey: '' },
      deps:     { matchesUniversityInText: vi.fn().mockReturnValue(false) },
    })

    await runFetch({ db, deps, mainWindow })

    expect(fs.unlinkSync).toHaveBeenCalled()
    expect(db.savePaper).not.toHaveBeenCalled()
  })

  it('rejects and deletes PDF when first page fails and org filter is active', async () => {
    const { db, deps, mainWindow } = makeCtx({
      deps: { extractFirstPage: vi.fn().mockResolvedValue({ success: false, error: 'corrupt' }) }
    })

    await runFetch({ db, deps, mainWindow })

    expect(fs.unlinkSync).toHaveBeenCalledWith('/tmp/2401.00001.pdf')
    expect(db.savePaper).not.toHaveBeenCalled()
  })

  it('continues when first page fails but org filter is empty', async () => {
    const { db, deps, mainWindow } = makeCtx({
      settings: { universityList: '', researchCenterList: '' },
      deps:     { extractFirstPage: vi.fn().mockResolvedValue({ success: false, error: 'corrupt' }) }
    })

    await runFetch({ db, deps, mainWindow })

    expect(fs.unlinkSync).not.toHaveBeenCalled()
    expect(db.savePaper).toHaveBeenCalledOnce()
  })
})

// ─── affiliations persistence ─────────────────────────────────────────────────

describe('runFetch — affiliations', () => {
  it('uses Semantic Scholar affiliations when available', async () => {
    const ssAffils = [{ name: 'Alice', affiliations: ['MIT'] }]
    const { db, deps, mainWindow } = makeCtx({
      deps: { getAffiliations: vi.fn().mockResolvedValue(ssAffils) }
    })

    await runFetch({ db, deps, mainWindow })

    expect(db.savePaper).toHaveBeenCalledWith(
      expect.objectContaining({ affiliations: JSON.stringify(ssAffils) })
    )
  })

  it('falls back to AI affiliations when Semantic Scholar returns null', async () => {
    const { db, deps, mainWindow } = makeCtx({
      deps:   { getAffiliations: vi.fn().mockResolvedValue(null) },
      llm:    { extractAffiliationsWithAI: vi.fn().mockResolvedValue(['MIT']) },
    })

    await runFetch({ db, deps, mainWindow })

    const saved = db.savePaper.mock.calls[0][0]
    const affils = JSON.parse(saved.affiliations)
    expect(affils[0].affiliations).toContain('MIT')
  })

  it('saves null affiliations when both SS and AI return nothing', async () => {
    const { db, deps, mainWindow } = makeCtx({
      deps: { getAffiliations: vi.fn().mockResolvedValue(null) },
      llm:  { extractAffiliationsWithAI: vi.fn().mockResolvedValue(null) },
    })

    await runFetch({ db, deps, mainWindow })

    expect(db.savePaper).toHaveBeenCalledWith(
      expect.objectContaining({ affiliations: null })
    )
  })
})

// ─── paper status ─────────────────────────────────────────────────────────────

describe('runFetch — paper status', () => {
  it('saves paper with status "ready" when text extraction succeeds', async () => {
    const { db, deps, mainWindow } = makeCtx()

    await runFetch({ db, deps, mainWindow })

    expect(db.savePaper).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ready', pdf_error: null })
    )
  })

  it('saves paper with status "pdf_error" when text extraction fails', async () => {
    const { db, deps, mainWindow } = makeCtx({
      deps: { extractText: vi.fn().mockResolvedValue({ success: false, error: 'bad encoding' }) }
    })

    await runFetch({ db, deps, mainWindow })

    expect(db.savePaper).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pdf_error', pdf_error: 'bad encoding' })
    )
  })
})

// ─── limits & notifications ───────────────────────────────────────────────────

describe('runFetch — limits and notifications', () => {
  it('stops saving after maxPapers is reached', async () => {
    const papers = Array.from({ length: 5 }, (_, i) => ({ ...PAPER, id: `240${i}.00001` }))
    const { db, deps, mainWindow } = makeCtx({
      settings: { maxPapers: '2' },
      deps:     { fetchPapers: vi.fn().mockResolvedValue(papers) },
    })

    await runFetch({ db, deps, mainWindow })

    expect(db.savePaper).toHaveBeenCalledTimes(2)
  })

  it('sends "new-papers" IPC event with the count when papers are saved', async () => {
    const { db, deps, mainWindow } = makeCtx()

    await runFetch({ db, deps, mainWindow })

    expect(mainWindow.webContents.send).toHaveBeenCalledWith('new-papers', 1)
  })

  it('does not send "new-papers" when no papers pass filters', async () => {
    const { db, deps, mainWindow } = makeCtx({
      deps: { downloadPdf: vi.fn().mockResolvedValue({ success: false, error: 'timeout' }) }
    })

    await runFetch({ db, deps, mainWindow })

    expect(mainWindow.webContents.send).not.toHaveBeenCalled()
  })

  it('returns the list of saved papers', async () => {
    const { db, deps, mainWindow } = makeCtx()

    const result = await runFetch({ db, deps, mainWindow })

    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('2401.00001')
  })
})