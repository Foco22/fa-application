import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import { runFetch, selectCandidates, PRERANK_CAP } from '../../../src/ipc/papers.js'
import { scoreEmbeddingAgainst, hasEmbeddingConfig } from '../../../src/embeddings/index.js'
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

  const mockEmbProvider = {
    id: 'openai:text-embedding-3-small',
    generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2]),
    ...overrides.embProvider,
  }

  const deps = {
    createLLM:             vi.fn().mockReturnValue(mockLLM),
    createEmbeddings:      vi.fn().mockReturnValue(mockEmbProvider),
    hasEmbeddingConfig:    hasEmbeddingConfig,
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
    writeFetchLog: vi.fn(),
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

// ─── selection phase: embedding provider gating ───────────────────────────────

describe('runFetch — embedding provider availability', () => {
  it('embeds with the local provider even when there is no API key configured', async () => {
    const { db, deps, mainWindow } = makeCtx({
      settings: { apiKey: '', embeddingProvider: 'local' },
      db: {
        getReferencePapers: vi.fn().mockReturnValue([
          { path: '/refs/a.pdf', snippet: 'AI', embedding: '[0.1,0.2]', abstract_summary: 's', embedding_model: 'local:Xenova/all-MiniLM-L6-v2' },
        ]),
      },
      embProvider: { id: 'local:Xenova/all-MiniLM-L6-v2' },
    })

    await runFetch({ db, deps, mainWindow })

    expect(deps.createEmbeddings).toHaveBeenCalled()
    expect(deps.createEmbeddings.mock.results[0].value.generateEmbedding).toHaveBeenCalled()
  })

  it('does not build an embedding provider for openai when no key is configured', async () => {
    const { db, deps, mainWindow } = makeCtx({
      settings: { apiKey: '', openaiApiKey: '', embeddingApiKey: '', embeddingProvider: 'openai' },
    })

    await runFetch({ db, deps, mainWindow })

    expect(deps.createEmbeddings).not.toHaveBeenCalled()
  })
})

// ─── selection phase: stale reference index ───────────────────────────────────

describe('runFetch — reference index embedded by a different model', () => {
  // Un vector de OpenAI (1536 dims) y uno de MiniLM (384) no son comparables:
  // mezclarlos produce similitudes basura. Los del otro modelo se ignoran hasta
  // que el usuario reindexe.
  it('ignores reference embeddings produced by a different model', async () => {
    const { db, deps, mainWindow } = makeCtx({
      settings: { keywordList: '' },
      db: {
        getReferencePapers: vi.fn().mockReturnValue([
          { path: '/refs/old.pdf', snippet: 'zzz', embedding: '[0.9,0.9,0.9]', abstract_summary: null, embedding_model: 'openai:text-embedding-3-small' },
        ]),
      },
      embProvider: { id: 'local:Xenova/all-MiniLM-L6-v2' },
    })

    await runFetch({ db, deps, mainWindow })

    // La única referencia es de otro modelo → no hay vectores comparables, así
    // que nunca se llega a embeber el abstract del candidato.
    expect(deps.createEmbeddings.mock.results[0].value.generateEmbedding).not.toHaveBeenCalled()
    expect(db.savePaper).not.toHaveBeenCalled()
  })

  it('uses reference embeddings that match the active model', async () => {
    const { db, deps, mainWindow } = makeCtx({
      settings: { keywordList: '' },
      db: {
        getReferencePapers: vi.fn().mockReturnValue([
          { path: '/refs/ok.pdf', snippet: 'zzz', embedding: '[0.1,0.2]', abstract_summary: null, embedding_model: 'openai:text-embedding-3-small' },
        ]),
      },
    })

    await runFetch({ db, deps, mainWindow })

    expect(deps.createEmbeddings.mock.results[0].value.generateEmbedding).toHaveBeenCalled()
    expect(db.savePaper).toHaveBeenCalled()
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
  it('saves the paper as a fallback when AI affiliations do not match and it is the only candidate', async () => {
    // No other candidate could take its place — better one imperfect paper than
    // an empty week. See "runFetch — org filter fallback" below for the cases
    // where a real match exists among the candidates instead.
    const { db, deps, mainWindow } = makeCtx({
      llm: { extractAffiliationsWithAI: vi.fn().mockResolvedValue(['Harvard']) },
    })

    await runFetch({ db, deps, mainWindow })

    expect(fs.unlinkSync).not.toHaveBeenCalled()
    expect(db.savePaper).toHaveBeenCalledOnce()
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

  it('saves as fallback via the matchesUniversityInText path too, when it is the only candidate', async () => {
    const { db, deps, mainWindow } = makeCtx({
      settings: { apiKey: '' },
      deps:     { matchesUniversityInText: vi.fn().mockReturnValue(false) },
    })

    await runFetch({ db, deps, mainWindow })

    expect(fs.unlinkSync).not.toHaveBeenCalled()
    expect(db.savePaper).toHaveBeenCalledOnce()
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

// ─── org filter — fallback when ALL candidates fail ───────────────────────────

describe('runFetch — org filter fallback', () => {
  function makeTwoCandidateCtx(affiliationsPerCall, overrides = {}) {
    const papers = [{ ...PAPER, id: 'p1' }, { ...PAPER, id: 'p2' }]
    const extractAffiliationsWithAI = vi.fn()
    for (const affils of affiliationsPerCall) extractAffiliationsWithAI.mockResolvedValueOnce(affils)

    return makeCtx({
      deps: {
        fetchPapers: vi.fn().mockResolvedValue(papers),
        downloadPdf: vi.fn().mockImplementation((id) => Promise.resolve({ success: true, path: `/tmp/${id}.pdf` })),
        ...overrides.deps,
      },
      llm: { extractAffiliationsWithAI, ...overrides.llm },
      ...overrides,
    })
  }

  it('does not trigger the fallback when at least one candidate passes — the rejected one is still deleted', async () => {
    const { db, deps, mainWindow } = makeTwoCandidateCtx([['Harvard'], ['Stanford University']])

    await runFetch({ db, deps, mainWindow })

    expect(fs.unlinkSync).toHaveBeenCalledWith('/tmp/p1.pdf')
    expect(db.savePaper).toHaveBeenCalledOnce()
    expect(db.savePaper.mock.calls[0][0].id).toBe('p2')
  })

  it('saves the best-ranked candidate as a fallback when ALL selected candidates fail the org filter', async () => {
    const { db, deps, mainWindow } = makeTwoCandidateCtx([['Harvard'], ['Oxford']])

    await runFetch({ db, deps, mainWindow })

    expect(db.savePaper).toHaveBeenCalledOnce()
    expect(db.savePaper.mock.calls[0][0].id).toBe('p1') // best-ranked = first in selection order
    expect(fs.unlinkSync).toHaveBeenCalledWith('/tmp/p2.pdf')
    expect(fs.unlinkSync).not.toHaveBeenCalledWith('/tmp/p1.pdf')
  })

  it('sends the new-papers notification for a fallback save', async () => {
    const { db, deps, mainWindow } = makeTwoCandidateCtx([['Harvard'], ['Oxford']])

    await runFetch({ db, deps, mainWindow })

    expect(mainWindow.webContents.send).toHaveBeenCalledWith('new-papers', 1)
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

// ─── selectCandidates — diagnostics report ────────────────────────────────────

describe('selectCandidates — diagnostics report', () => {
  it('marks a rejected candidate with a reason describing the scores', async () => {
    const candidates = [{ ...PAPER, abstract: 'unrelated content about gardening' }]
    const db = { getReferencePapers: vi.fn().mockReturnValue([
      { embedding: '[1,0]', snippet: '', abstract_summary: 'AI research' }
    ]) }
    const deps = {
      scoreEmbeddingAgainst, embedKeywordList: vi.fn().mockResolvedValue([]),
      extractKeywords, keywordOverlap, createReranker: vi.fn(),
    }
    const embProvider = { generateEmbedding: vi.fn().mockResolvedValue([0, 1]) } // orthogonal to ref [1,0]

    const { report } = await selectCandidates(candidates, { db, deps, settings: { ...SETTINGS }, embProvider, similarityThreshold: 0.6 })

    expect(report).toHaveLength(1)
    expect(report[0]).toMatchObject({ id: PAPER.id, title: PAPER.title, authors: PAPER.authors, decision: 'rejected', stage: 'selection' })
    expect(report[0].selection).toMatchObject({ passed: false })
    expect(report[0].reason).toMatch(/embSimRef/)
  })

  it('marks all candidates as pending with a "no interest signal" reason when nothing is configured', async () => {
    const candidates = [{ ...PAPER }]
    const db = { getReferencePapers: vi.fn().mockReturnValue([]) }
    const deps = { scoreEmbeddingAgainst, embedKeywordList: vi.fn().mockResolvedValue([]), extractKeywords, keywordOverlap, createReranker: vi.fn() }

    const { report } = await selectCandidates(candidates, { db, deps, settings: { ...SETTINGS, keywordList: '' }, embProvider: null, similarityThreshold: 0.6 })

    expect(report[0].decision).toBe('pending')
    expect(report[0].reason).toMatch(/sin/i)
  })

  it('marks candidates that pass the interest filter but fall outside PRERANK_CAP as rejected at rerank_cap', async () => {
    const candidates = Array.from({ length: 20 }, (_, i) => ({ ...PAPER, id: `p${i}`, abstract: `abstract ${i} about ai` }))
    const db = { getReferencePapers: vi.fn().mockReturnValue([{ embedding: '[1,0]', snippet: '', abstract_summary: 'profile' }]) }
    const deps = {
      scoreEmbeddingAgainst, embedKeywordList: vi.fn().mockResolvedValue([]), extractKeywords, keywordOverlap,
      createReranker: vi.fn().mockReturnValue({
        rerank: vi.fn().mockImplementation(async (_q, docs) => docs.map((_, index) => ({ index, score: 1 - index * 0.01 }))),
      }),
    }
    const embProvider = { generateEmbedding: vi.fn().mockResolvedValue([1, 0]) }

    const { report } = await selectCandidates(candidates, { db, deps, settings: { ...SETTINGS }, embProvider, similarityThreshold: 0.6 })

    const cutOff = report.filter(e => e.stage === 'rerank_cap')
    expect(cutOff).toHaveLength(20 - PRERANK_CAP)
    expect(cutOff[0].decision).toBe('rejected')
  })

  it('fills rerank rank/score for survivors', async () => {
    const candidates = [0, 1, 2].map(i => ({ ...PAPER, id: `p${i}`, abstract: `abstract ${i} about ai` }))
    const db = { getReferencePapers: vi.fn().mockReturnValue([{ embedding: '[1,0]', snippet: '', abstract_summary: 'profile' }]) }
    const rerankSpy = vi.fn().mockResolvedValue([{ index: 2, score: 0.9 }, { index: 0, score: 0.5 }, { index: 1, score: 0.1 }])
    const deps = {
      scoreEmbeddingAgainst, embedKeywordList: vi.fn().mockResolvedValue([]), extractKeywords, keywordOverlap,
      createReranker: vi.fn().mockReturnValue({ rerank: rerankSpy }),
    }
    const embProvider = { generateEmbedding: vi.fn().mockResolvedValue([1, 0]) }

    const { report } = await selectCandidates(candidates, { db, deps, settings: { ...SETTINGS }, embProvider, similarityThreshold: 0.6 })

    expect(report.find(e => e.id === 'p2').rerank).toMatchObject({ rank: 1, score: 0.9 })
    expect(report.find(e => e.id === 'p1').rerank).toMatchObject({ rank: 3, score: 0.1 })
  })
})

// ─── runFetch — fetch log (deps.writeFetchLog) ────────────────────────────────

describe('runFetch — fetch log', () => {
  it('calls deps.writeFetchLog with per-paper diagnostics and overall stats', async () => {
    const { db, deps, mainWindow } = makeCtx()

    await runFetch({ db, deps, mainWindow })

    expect(deps.writeFetchLog).toHaveBeenCalledOnce()
    const report = deps.writeFetchLog.mock.calls[0][0]
    expect(report.stats).toEqual({ totalCandidates: 1, selected: 1, saved: 1 })
    expect(report.entries).toHaveLength(1)
    expect(report.entries[0]).toMatchObject({ id: '2401.00001', decision: 'saved', stage: 'saved' })
  })

  it('does not throw when deps.writeFetchLog is not provided', async () => {
    const { db, deps, mainWindow } = makeCtx({ deps: { writeFetchLog: undefined } })

    await expect(runFetch({ db, deps, mainWindow })).resolves.toBeDefined()
  })

  it('marks the entry for a paper whose PDF download fails', async () => {
    const { db, deps, mainWindow } = makeCtx({
      deps: { downloadPdf: vi.fn().mockResolvedValue({ success: false, error: 'timeout' }) }
    })

    await runFetch({ db, deps, mainWindow })

    const report = deps.writeFetchLog.mock.calls[0][0]
    expect(report.entries[0]).toMatchObject({ decision: 'rejected', stage: 'download' })
    expect(report.entries[0].reason).toContain('timeout')
  })

  it('marks the entry for a paper rejected by the org filter, including the AI-detected affiliation, when another candidate is saved instead', async () => {
    const papers = [{ ...PAPER, id: 'p1' }, { ...PAPER, id: 'p2' }]
    const { db, deps, mainWindow } = makeCtx({
      deps: {
        fetchPapers: vi.fn().mockResolvedValue(papers),
        downloadPdf: vi.fn().mockImplementation((id) => Promise.resolve({ success: true, path: `/tmp/${id}.pdf` })),
      },
      llm: {
        extractAffiliationsWithAI: vi.fn()
          .mockResolvedValueOnce(['Harvard'])
          .mockResolvedValueOnce(['Stanford University']),
      },
    })

    await runFetch({ db, deps, mainWindow })

    const report = deps.writeFetchLog.mock.calls[0][0]
    const rejected = report.entries.find(e => e.id === 'p1')
    expect(rejected).toMatchObject({ decision: 'rejected', stage: 'org_filter' })
    expect(rejected.university).toContain('Harvard')
  })

  it('marks a fallback-saved entry with a reason mentioning the fallback', async () => {
    const { db, deps, mainWindow } = makeCtx({
      llm: { extractAffiliationsWithAI: vi.fn().mockResolvedValue(['Harvard']) },
    })

    await runFetch({ db, deps, mainWindow })

    const report = deps.writeFetchLog.mock.calls[0][0]
    expect(report.entries[0]).toMatchObject({ decision: 'saved', stage: 'saved' })
    expect(report.entries[0].reason).toMatch(/fallback/i)
  })

  it('marks survivors beyond maxPapers as rejected at the maxpapers_cutoff stage', async () => {
    const papers = [
      { ...PAPER, id: 'p1', abstract: 'A paper about ai systems.' },
      { ...PAPER, id: 'p2', abstract: 'Another paper about ai systems.' },
    ]
    const { db, deps, mainWindow } = makeCtx({
      settings: { maxPapers: '1', keywordList: 'ai' },
      deps: { fetchPapers: vi.fn().mockResolvedValue(papers) },
    })

    await runFetch({ db, deps, mainWindow })

    const report = deps.writeFetchLog.mock.calls[0][0]
    const overflow = report.entries.find(e => e.id === 'p2')
    expect(overflow).toMatchObject({ decision: 'rejected', stage: 'maxpapers_cutoff' })
  })
})

// ─── OCR-002: el fetch NUNCA dispara OCR ────────────────────────────────────────

describe('runFetch — never triggers OCR (OCR-002)', () => {
  it('does not call transcribePageToMarkdown on any candidate', async () => {
    const transcribePageToMarkdown = vi.fn()
    const { db, deps, mainWindow } = makeCtx({
      llm: { extractAffiliationsWithAI: vi.fn().mockResolvedValue(['MIT']), transcribePageToMarkdown },
    })

    await runFetch({ db, deps, mainWindow })

    expect(transcribePageToMarkdown).not.toHaveBeenCalled()
  })

  it('saves ingested papers with pdf_text_source = "pdf-parse"', async () => {
    const { db, deps, mainWindow } = makeCtx()

    await runFetch({ db, deps, mainWindow })

    expect(db.savePaper).toHaveBeenCalledWith(expect.objectContaining({ pdf_text_source: 'pdf-parse' }))
  })
})