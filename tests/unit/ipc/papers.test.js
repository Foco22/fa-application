import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import { runFetch, selectCandidates, RERANK_CAP } from '../../../src/ipc/papers.js'
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
    getPapers:        vi.fn().mockReturnValue([]),
    savePaper:        vi.fn(),
    deletePaper:      vi.fn(),
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
      writeOcr:   vi.fn(),
    },
    transcribePdfToMarkdown: vi.fn().mockResolvedValue({ success: true, markdown: '# vision OCR', pageCount: 2, fallbackUsed: false }),
    parsePdfWithLlamaParse:  vi.fn().mockResolvedValue({ success: true, markdown: '# LlamaParse OCR', pageCount: 3 }),
    rasterizePdf: vi.fn(), extractPagesText: vi.fn(), OCR_MAX_CHARS: 200000,
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

  it('does NOT accept via keywords extracted from the references when embedding similarity is low', async () => {
    const { db, deps, mainWindow } = makeCtx({
      db: { getReferencePapers: vi.fn().mockReturnValue([
        { embedding: '[1,0]', snippet: 'we look at ai and other systems.', abstract_summary: 'A summary.' }
      ]) },
      deps: { createEmbeddings: vi.fn().mockReturnValue({ generateEmbedding: vi.fn().mockResolvedValue([0, 1]) }) },
    })
    // "ai" is extracted from the reference snippet and literally appears in
    // PAPER.abstract ("A paper about AI."), but the embedding says unrelated.
    // Snippet keywords are generic RAKE noise: they must not override the embedding.

    await runFetch({ db, deps, mainWindow })

    expect(db.savePaper).not.toHaveBeenCalled()
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

  it('falls back to the declared keywordList when there is no embedding provider', async () => {
    const { db, deps, mainWindow } = makeCtx({
      settings: { apiKey: '', openaiApiKey: '', embeddingApiKey: '', embeddingProvider: 'openai', keywordList: 'ai' },
      db: { getReferencePapers: vi.fn().mockReturnValue([
        { embedding: '[1,0]', snippet: 'x', abstract_summary: 'x' }
      ]) },
    })

    await runFetch({ db, deps, mainWindow })

    // no embedding provider → embeddings can't decide → literal keyword ("ai") is the only signal left
    expect(deps.createEmbeddings).not.toHaveBeenCalled()
    expect(db.savePaper).toHaveBeenCalledOnce()
  })

  it('rejects when there is no embedding provider and the declared keywords do not match', async () => {
    const { db, deps, mainWindow } = makeCtx({
      settings: { apiKey: '', openaiApiKey: '', embeddingApiKey: '', embeddingProvider: 'openai', keywordList: 'marine biology' },
    })

    await runFetch({ db, deps, mainWindow })

    expect(db.savePaper).not.toHaveBeenCalled()
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

  // Regresión (fetch log 2026-09-08): "LLM-Assisted … Agent-Based Energy Adoption
  // Models" se guardó con embSimRef=0.455 / embSimInterest=0.318 (umbral 0.50)
  // sólo porque el keyword genérico "agent" aparece en su abstract.
  it('rejects a paper whose abstract contains a declared keyword but whose embedding similarity is below threshold', async () => {
    const { db, deps, mainWindow } = makeCtx({
      settings: { keywordList: 'agent', similarityThreshold: '0.5' },
      deps: {
        fetchPapers: vi.fn().mockResolvedValue([{ ...PAPER, abstract: 'Agent-based models of household energy adoption.' }]),
        embedKeywordList: vi.fn().mockResolvedValue([{ keyword: 'agent', embedding: [1, 0] }]),
        // cos([0.3, 0.95], [1, 0]) ≈ 0.30 → well under 0.5
        createEmbeddings: vi.fn().mockReturnValue({ generateEmbedding: vi.fn().mockResolvedValue([0.3, 0.95]) }),
      },
    })

    await runFetch({ db, deps, mainWindow })

    expect(db.savePaper).not.toHaveBeenCalled()
    const report = deps.writeFetchLog.mock.calls[0][0]
    expect(report.entries[0]).toMatchObject({ decision: 'rejected', stage: 'selection' })
    expect(report.entries[0].selection).toMatchObject({ kwInterest: true, passed: false })
  })

  it('still accepts when the embedding clears the threshold and the keyword also matches', async () => {
    const { db, deps, mainWindow } = makeCtx({
      settings: { keywordList: 'agent', similarityThreshold: '0.5' },
      deps: {
        fetchPapers: vi.fn().mockResolvedValue([{ ...PAPER, abstract: 'Multi-agent planning with language models.' }]),
        embedKeywordList: vi.fn().mockResolvedValue([{ keyword: 'agent', embedding: [1, 0] }]),
        createEmbeddings: vi.fn().mockReturnValue({ generateEmbedding: vi.fn().mockResolvedValue([1, 0]) }),
      },
    })

    await runFetch({ db, deps, mainWindow })

    expect(db.savePaper).toHaveBeenCalledOnce()
  })

  it('uses a keyword hit only as a ranking boost among papers that already passed on embeddings', async () => {
    const candidates = [
      { ...PAPER, id: 'plain',   abstract: 'A study of planning.' },
      { ...PAPER, id: 'boosted', abstract: 'A study of agent planning.' },
    ]
    const db = { getReferencePapers: vi.fn().mockReturnValue([]) }
    const deps = {
      scoreEmbeddingAgainst,
      embedKeywordList: vi.fn().mockResolvedValue([{ keyword: 'agent', embedding: [1, 0] }]),
      extractKeywords, keywordOverlap,
      // identity reranker: keeps the order selectCandidates handed it, so this test sees the boost
      createReranker: vi.fn().mockReturnValue({
        rerank: vi.fn().mockImplementation(async (_q, docs) => docs.map((_, index) => ({ index, score: 1 }))),
      }),
    }
    // both embed identically (sim 1.0 ≥ threshold); only "boosted" also hits the keyword
    const embProvider = { generateEmbedding: vi.fn().mockResolvedValue([1, 0]) }

    const { survivors } = await selectCandidates(candidates, {
      db, deps, settings: { ...SETTINGS, keywordList: 'agent' }, embProvider, similarityThreshold: 0.5,
    })

    expect(survivors.map(p => p.id)).toEqual(['boosted', 'plain'])
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

// ─── rerank (no cap — a single ranking pass) ──────────────────────────────────

describe('selectCandidates — rerank', () => {
  function makeCandidates(n) {
    return Array.from({ length: n }, (_, i) => ({ ...PAPER, id: `p${i}`, abstract: `abstract ${i} about ai` }))
  }

  // Regresión: con el pool de una semana completa (~4.300 papers) sobrevivían ~2.000
  // y el rerank (cada uno × ~10 queries, en el proceso principal) dejaba la app
  // colgada. Solo los mejores por similitud entran al cross-encoder.
  it('sends only the top RERANK_CAP survivors (by similarity) to the reranker and logs the rest as rerank_cap', async () => {
    const candidates = Array.from({ length: RERANK_CAP + 30 }, (_, i) => ({ ...PAPER, id: `p${i}`, abstract: `abstract ${i}` }))
    const db = { getReferencePapers: vi.fn().mockReturnValue([{ embedding: '[1,0]', snippet: '', abstract_summary: 'profile' }]) }
    const rerankSpy = vi.fn().mockImplementation(async (_q, docs) => docs.map((_, index) => ({ index, score: 1 })))
    const deps = {
      scoreEmbeddingAgainst,
      embedKeywordList: vi.fn().mockResolvedValue([]),
      extractKeywords, keywordOverlap,
      createReranker: vi.fn().mockReturnValue({ rerank: rerankSpy }),
    }
    // candidate i embeds to [1, i/1000]: similarity to the reference [1,0] falls as i grows
    const embProvider = {
      generateEmbeddings: vi.fn().mockImplementation(async texts => texts.map((_, i) => [1, i / 1000])),
    }

    const { survivors, report } = await selectCandidates(candidates, {
      db, deps, settings: { ...SETTINGS }, embProvider, similarityThreshold: 0.6,
    })

    expect(rerankSpy.mock.calls[0][1]).toEqual(candidates.slice(0, RERANK_CAP).map(c => c.abstract))
    expect(survivors).toHaveLength(RERANK_CAP)
    const capped = report.filter(e => e.stage === 'rerank_cap')
    expect(capped).toHaveLength(30)
    expect(capped[0]).toMatchObject({ decision: 'rejected' })
    expect(capped.map(e => e.id)).toEqual(candidates.slice(RERANK_CAP).map(c => c.id))
  })

  it('does not cap anything when there are fewer survivors than RERANK_CAP', async () => {
    const candidates = Array.from({ length: 5 }, (_, i) => ({ ...PAPER, id: `p${i}`, abstract: `abstract ${i}` }))
    const db = { getReferencePapers: vi.fn().mockReturnValue([{ embedding: '[1,0]', snippet: '', abstract_summary: 'profile' }]) }
    const deps = {
      scoreEmbeddingAgainst, embedKeywordList: vi.fn().mockResolvedValue([]), extractKeywords, keywordOverlap,
      createReranker: vi.fn().mockReturnValue({ rerank: async (_q, docs) => docs.map((_, index) => ({ index, score: 1 })) }),
    }
    const embProvider = { generateEmbedding: vi.fn().mockResolvedValue([1, 0]) }

    const { survivors, report } = await selectCandidates(candidates, { db, deps, settings: { ...SETTINGS }, embProvider, similarityThreshold: 0.6 })

    expect(survivors).toHaveLength(5)
    expect(report.some(e => e.stage === 'rerank_cap')).toBe(false)
  })

  it('sends the interest-filter survivors to the reranker', async () => {
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
    expect(rerankSpy.mock.calls[0][1]).toHaveLength(30)
  })

  it('embeds all candidate abstracts through the provider batch method, not one call per paper', async () => {
    const candidates = makeCandidates(40)
    const db = { getReferencePapers: vi.fn().mockReturnValue([
      { embedding: '[1,0]', snippet: '', abstract_summary: 'profile', embedding_model: 'openai:text-embedding-3-small' },
    ]) }
    const deps = {
      scoreEmbeddingAgainst,
      embedKeywordList: vi.fn().mockResolvedValue([]),
      extractKeywords, keywordOverlap,
      createReranker: vi.fn().mockReturnValue({
        rerank: vi.fn().mockImplementation(async (_q, docs) => docs.map((_, index) => ({ index, score: 1 }))),
      }),
    }
    const embProvider = {
      id: 'openai:text-embedding-3-small',
      generateEmbedding: vi.fn(),
      generateEmbeddings: vi.fn().mockImplementation(async texts => texts.map(() => [1, 0])),
    }

    const { survivors } = await selectCandidates(candidates, { db, deps, settings: { ...SETTINGS }, embProvider, similarityThreshold: 0.6 })

    expect(embProvider.generateEmbeddings).toHaveBeenCalledOnce()
    expect(embProvider.generateEmbeddings.mock.calls[0][0]).toEqual(candidates.map(c => c.abstract))
    expect(embProvider.generateEmbedding).not.toHaveBeenCalled()
    expect(survivors).toHaveLength(40)
  })

  // Regresión: una sola query con todos los resúmenes + keywords desbordaba el
  // límite del cross-encoder y se truncaban justo las keywords del final.
  it('reranks with one separate query per reference summary plus one for the declared keywords', async () => {
    const candidates = makeCandidates(2)
    const db = { getReferencePapers: vi.fn().mockReturnValue([
      { embedding: '[1,0]', snippet: '', abstract_summary: 'summary of reference one' },
      { embedding: '[1,0]', snippet: '', abstract_summary: 'summary of reference two' },
    ]) }
    const rerankSpy = vi.fn().mockImplementation(async (_q, docs) => docs.map((_, index) => ({ index, score: 1 })))
    const deps = {
      scoreEmbeddingAgainst,
      embedKeywordList: vi.fn().mockResolvedValue([]),
      extractKeywords, keywordOverlap,
      createReranker: vi.fn().mockReturnValue({ rerank: rerankSpy }),
    }
    const embProvider = { generateEmbedding: vi.fn().mockResolvedValue([1, 0]) }

    await selectCandidates(candidates, {
      db, deps, settings: { ...SETTINGS, keywordList: 'context engineering\nmemory agent' }, embProvider, similarityThreshold: 0.6,
    })

    expect(rerankSpy.mock.calls[0][0]).toEqual([
      'summary of reference one',
      'summary of reference two',
      'context engineering, memory agent',
    ])
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

describe('runFetch — org filter (affiliation no longer blocks, only tags)', () => {
  it('saves the paper even when AI affiliation does not match, with matched_affiliation: 0', async () => {
    const { db, deps, mainWindow } = makeCtx({
      llm: { extractAffiliationsWithAI: vi.fn().mockResolvedValue(['Harvard']) },
    })

    await runFetch({ db, deps, mainWindow })

    expect(fs.unlinkSync).not.toHaveBeenCalled()
    expect(db.savePaper).toHaveBeenCalledWith(expect.objectContaining({ matched_affiliation: 0 }))
  })

  it('saves the paper with matched_affiliation: 1 when AI affiliation matches org filter', async () => {
    const { db, deps, mainWindow } = makeCtx({
      llm: { extractAffiliationsWithAI: vi.fn().mockResolvedValue(['Stanford University']) },
    })

    await runFetch({ db, deps, mainWindow })

    expect(db.savePaper).toHaveBeenCalledWith(expect.objectContaining({ matched_affiliation: 1 }))
  })

  it('saves with matched_affiliation: null when org filter is empty — nothing to evaluate against', async () => {
    const { db, deps, mainWindow } = makeCtx({
      settings: { universityList: '', researchCenterList: '' },
      llm:      { extractAffiliationsWithAI: vi.fn().mockResolvedValue(['Unknown University']) },
    })

    await runFetch({ db, deps, mainWindow })

    expect(db.savePaper).toHaveBeenCalledWith(expect.objectContaining({ matched_affiliation: null }))
  })

  it('falls back to matchesUniversityInText when no LLM is available', async () => {
    const { db, deps, mainWindow } = makeCtx({
      settings: { apiKey: '' },
    })

    await runFetch({ db, deps, mainWindow })

    expect(deps.matchesUniversityInText).toHaveBeenCalledWith('first page MIT', ['MIT', 'Stanford'])
  })

  it('saves via the matchesUniversityInText path too, with matched_affiliation: 0 on no match', async () => {
    const { db, deps, mainWindow } = makeCtx({
      settings: { apiKey: '' },
      deps:     { matchesUniversityInText: vi.fn().mockReturnValue(false) },
    })

    await runFetch({ db, deps, mainWindow })

    expect(fs.unlinkSync).not.toHaveBeenCalled()
    expect(db.savePaper).toHaveBeenCalledWith(expect.objectContaining({ matched_affiliation: 0 }))
  })

  it('saves with matched_affiliation: null (not rejected) when first page extraction fails and org filter is active', async () => {
    const { db, deps, mainWindow } = makeCtx({
      deps: { extractFirstPage: vi.fn().mockResolvedValue({ success: false, error: 'corrupt' }) }
    })

    await runFetch({ db, deps, mainWindow })

    expect(fs.unlinkSync).not.toHaveBeenCalled()
    expect(db.savePaper).toHaveBeenCalledWith(expect.objectContaining({ matched_affiliation: null }))
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

// ─── org filter — every finalist is saved, matched or not ────────────────────

describe('runFetch — every finalist is saved regardless of affiliation match', () => {
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

  it('saves both candidates when one matches and the other does not — neither PDF is deleted', async () => {
    const { db, deps, mainWindow } = makeTwoCandidateCtx([['Harvard'], ['Stanford University']])

    await runFetch({ db, deps, mainWindow })

    expect(fs.unlinkSync).not.toHaveBeenCalled()
    expect(db.savePaper).toHaveBeenCalledTimes(2)
    expect(db.savePaper).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1', matched_affiliation: 0 }))
    expect(db.savePaper).toHaveBeenCalledWith(expect.objectContaining({ id: 'p2', matched_affiliation: 1 }))
  })

  it('saves both candidates when NEITHER matches the org filter', async () => {
    const { db, deps, mainWindow } = makeTwoCandidateCtx([['Harvard'], ['Oxford']])

    await runFetch({ db, deps, mainWindow })

    expect(db.savePaper).toHaveBeenCalledTimes(2)
    expect(db.savePaper).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1', matched_affiliation: 0 }))
    expect(db.savePaper).toHaveBeenCalledWith(expect.objectContaining({ id: 'p2', matched_affiliation: 0 }))
    expect(fs.unlinkSync).not.toHaveBeenCalled()
  })

  it('sends the new-papers notification with the full count, not just the matched ones', async () => {
    const { db, deps, mainWindow } = makeTwoCandidateCtx([['Harvard'], ['Oxford']])

    await runFetch({ db, deps, mainWindow })

    expect(mainWindow.webContents.send).toHaveBeenCalledWith('new-papers', 2)
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

// ─── regla: nunca más de maxPapers por SEMANA ─────────────────────────────────
// maxPapers es un tope semanal, no por ejecución: ejecutar el fetch varias veces
// en la misma semana iba acumulando papers.

describe('runFetch — weekly quota', () => {
  const stampNow = () => new Date().toISOString().slice(0, 19).replace('T', ' ')
  const thisWeek = (id, extra = {}) => ({ id, title: `T ${id}`, created_at: stampNow(), summary: null, quiz: null, notes: null, ...extra })
  const manyPapers = (n) => Array.from({ length: n }, (_, i) => ({ ...PAPER, id: `new${i}` }))

  it('only fills the slots that are still free this week', async () => {
    const { db, deps, mainWindow } = makeCtx({
      settings: { maxPapers: '3' },
      db:       { getPapers: vi.fn().mockReturnValue([thisWeek('old1')]) },
      deps:     { fetchPapers: vi.fn().mockResolvedValue(manyPapers(5)) },
    })

    await runFetch({ db, deps, mainWindow })

    expect(db.savePaper).toHaveBeenCalledTimes(2)
    expect(db.deletePaper).not.toHaveBeenCalled()
  })

  it('does not even query ArXiv when the week is already full, and explains why', async () => {
    const { db, deps, mainWindow } = makeCtx({
      settings: { maxPapers: '3' },
      db:       { getPapers: vi.fn().mockReturnValue([thisWeek('a'), thisWeek('b'), thisWeek('c')]) },
    })

    const result = await runFetch({ db, deps, mainWindow })

    expect(deps.fetchPapers).not.toHaveBeenCalled()
    expect(db.savePaper).not.toHaveBeenCalled()
    expect(result.saved).toEqual([])
    expect(result.empty).toMatchObject({ code: 'week_full', count: 3, max: 3 })
    expect(typeof result.empty.message).toBe('string')
  })

  it('ignores reference papers and papers from earlier weeks when counting', async () => {
    const { db, deps, mainWindow } = makeCtx({
      settings: { maxPapers: '1' },
      db: { getPapers: vi.fn().mockReturnValue([
        thisWeek('ref-attention'),
        thisWeek('2001.00001', { created_at: '2000-01-01 00:00:00' }),
      ]) },
    })

    await runFetch({ db, deps, mainWindow })

    expect(db.savePaper).toHaveBeenCalledTimes(1)
  })

  describe('replaceWeek', () => {
    it('uses the full quota again and deletes the previous papers of the week once the new ones are saved', async () => {
      const olds = [thisWeek('oldA'), thisWeek('oldB'), thisWeek('oldC')]
      const { db, deps, mainWindow } = makeCtx({
        settings: { maxPapers: '3' },
        db:       { getPapers: vi.fn().mockReturnValue(olds) },
        deps:     { fetchPapers: vi.fn().mockResolvedValue(manyPapers(5)) },
      })

      const result = await runFetch({ db, deps, mainWindow, replaceWeek: true })

      expect(result).toHaveLength(3)
      expect(db.deletePaper.mock.calls.map(c => c[0]).sort()).toEqual(['oldA', 'oldB', 'oldC'])
      expect(deps.vault.deletePaperDir).toHaveBeenCalledTimes(3)
    })

    it('keeps the previous papers when the new run saves nothing (never leave the week empty)', async () => {
      const { db, deps, mainWindow } = makeCtx({
        settings: { maxPapers: '3' },
        db:       { getPapers: vi.fn().mockReturnValue([thisWeek('oldA')]) },
        deps:     { downloadPdf: vi.fn().mockResolvedValue({ success: false, error: 'timeout' }) },
      })

      await runFetch({ db, deps, mainWindow, replaceWeek: true })

      expect(db.deletePaper).not.toHaveBeenCalled()
      expect(deps.vault.deletePaperDir).not.toHaveBeenCalled()
    })

    it('does not delete a previous paper that was selected again (it would erase the new copy)', async () => {
      const { db, deps, mainWindow } = makeCtx({
        settings: { maxPapers: '3' },
        db: { getPapers: vi.fn().mockReturnValue([thisWeek(PAPER.id), thisWeek('oldB')]) },
        deps: { fetchPapers: vi.fn().mockResolvedValue([{ ...PAPER }]) },
      })

      await runFetch({ db, deps, mainWindow, replaceWeek: true })

      expect(db.deletePaper.mock.calls.map(c => c[0])).toEqual(['oldB'])
    })

    it('never deletes reference papers or papers from earlier weeks', async () => {
      const { db, deps, mainWindow } = makeCtx({
        settings: { maxPapers: '3' },
        db: { getPapers: vi.fn().mockReturnValue([
          thisWeek('ref-attention'),
          thisWeek('2001.00001', { created_at: '2000-01-01 00:00:00' }),
        ]) },
      })

      await runFetch({ db, deps, mainWindow, replaceWeek: true })

      expect(db.deletePaper).not.toHaveBeenCalled()
    })
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

  // Regresión: el corte a maxPapers ocurría ANTES de descargar, así que un PDF
  // caído no se reponía con el siguiente sobreviviente y llegaban 2 en vez de 3.
  it('replaces a paper whose PDF download failed with the next survivor, up to maxPapers', async () => {
    const papers = Array.from({ length: 5 }, (_, i) => ({ ...PAPER, id: `p${i}` }))
    const downloadPdf = vi.fn()
      .mockResolvedValueOnce({ success: false, error: 'timeout' })
      .mockResolvedValue({ success: true, path: '/tmp/x.pdf' })
    const { db, deps, mainWindow } = makeCtx({
      settings: { maxPapers: '2' },
      deps:     { fetchPapers: vi.fn().mockResolvedValue(papers), downloadPdf },
    })

    await runFetch({ db, deps, mainWindow })

    expect(db.savePaper.mock.calls.map(c => c[0].id)).toEqual(['p1', 'p2'])
    expect(downloadPdf).toHaveBeenCalledTimes(3)
  })

  it('does not download more PDFs than needed once maxPapers is reached', async () => {
    const papers = Array.from({ length: 5 }, (_, i) => ({ ...PAPER, id: `p${i}` }))
    const { db, deps, mainWindow } = makeCtx({
      settings: { maxPapers: '2' },
      deps:     { fetchPapers: vi.fn().mockResolvedValue(papers) },
    })

    await runFetch({ db, deps, mainWindow })

    expect(deps.downloadPdf).toHaveBeenCalledTimes(2)
  })

  it('saves fewer than maxPapers when the survivors run out, and keeps each failure reason in the log', async () => {
    const papers = [{ ...PAPER, id: 'p0' }, { ...PAPER, id: 'p1' }, { ...PAPER, id: 'p2' }]
    const downloadPdf = vi.fn()
      .mockResolvedValueOnce({ success: false, error: 'timeout' })
      .mockResolvedValueOnce({ success: false, error: '404' })
      .mockResolvedValue({ success: true, path: '/tmp/x.pdf' })
    const { db, deps, mainWindow } = makeCtx({
      settings: { maxPapers: '3' },
      deps:     { fetchPapers: vi.fn().mockResolvedValue(papers), downloadPdf },
    })

    await runFetch({ db, deps, mainWindow })

    expect(db.savePaper).toHaveBeenCalledTimes(1)
    const report = deps.writeFetchLog.mock.calls[0][0]
    expect(report.entries.find(e => e.id === 'p0')).toMatchObject({ decision: 'rejected', stage: 'download' })
    expect(report.entries.find(e => e.id === 'p1')).toMatchObject({ decision: 'rejected', stage: 'download' })
    expect(report.stats).toEqual({ totalCandidates: 3, selected: 3, saved: 1 })
  })

  // El fetch ya no falla en silencio: si no guarda nada, devuelve el motivo.
  it('explains why nothing was saved when ArXiv returned no candidates', async () => {
    const { db, deps, mainWindow } = makeCtx({ deps: { fetchPapers: vi.fn().mockResolvedValue([]) } })

    const result = await runFetch({ db, deps, mainWindow })

    expect(result.saved).toEqual([])
    expect(result.empty).toMatchObject({ code: 'no_candidates' })
    expect(typeof result.empty.message).toBe('string')
    expect(mainWindow.webContents.send).not.toHaveBeenCalledWith('new-papers', expect.anything())
  })

  it('explains why nothing was saved when no candidate passed the interest filter', async () => {
    const { db, deps, mainWindow } = makeCtx({
      settings: { keywordList: 'marine biology', similarityThreshold: '0.5' },
      deps: {
        embedKeywordList: vi.fn().mockResolvedValue([{ keyword: 'marine biology', embedding: [0, 1] }]),
        createEmbeddings: vi.fn().mockReturnValue({ generateEmbedding: vi.fn().mockResolvedValue([1, 0]) }),
      },
    })

    const result = await runFetch({ db, deps, mainWindow })

    expect(result.empty).toMatchObject({ code: 'none_passed', candidates: 1, threshold: 0.5 })
    expect(result.empty.message).toMatch(/0\.50/)
  })

  it('explains why nothing was saved when every PDF download failed', async () => {
    const { db, deps, mainWindow } = makeCtx({
      deps: { downloadPdf: vi.fn().mockResolvedValue({ success: false, error: 'timeout' }) },
    })

    const result = await runFetch({ db, deps, mainWindow })

    expect(result.empty).toMatchObject({ code: 'downloads_failed', survivors: 1, firstError: 'timeout' })
  })

  it('writes the explanation message in the persisted language', async () => {
    const { db, deps, mainWindow } = makeCtx({
      settings: { language: 'en' },
      deps: { fetchPapers: vi.fn().mockResolvedValue([]) },
    })

    const result = await runFetch({ db, deps, mainWindow })

    expect(result.empty.message).toMatch(/ArXiv returned no papers/)
  })

  it('still returns the plain array of saved papers when something was saved', async () => {
    const { db, deps, mainWindow } = makeCtx()

    const result = await runFetch({ db, deps, mainWindow })

    expect(Array.isArray(result)).toBe(true)
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

    expect(mainWindow.webContents.send).not.toHaveBeenCalledWith('new-papers', expect.anything())
  })

  // La barra de progreso del botón Fetch: runFetch emite 'fetch-progress' por etapa.
  describe('fetch-progress events', () => {
    const progressEvents = (mainWindow) =>
      mainWindow.webContents.send.mock.calls.filter(c => c[0] === 'fetch-progress').map(c => c[1])

    function ctxWithAllStages() {
      return makeCtx({
        settings: { maxPapers: '1', similarityThreshold: '0.5' },
        db: { getReferencePapers: vi.fn().mockReturnValue([
          { embedding: '[1,0]', snippet: '', abstract_summary: 'A summary.', embedding_model: 'openai:text-embedding-3-small' },
        ]) },
        deps: {
          fetchPapers: vi.fn().mockImplementation(async (_s, _h, _d, _sl, onProgress) => {
            onProgress({ loaded: 1, total: 1 })
            return [{ ...PAPER }]
          }),
          createEmbeddings: vi.fn().mockReturnValue({
            id: 'openai:text-embedding-3-small',
            generateEmbedding: vi.fn().mockResolvedValue([1, 0]),
          }),
        },
      })
    }

    it('reports the stages in pipeline order: arxiv → embedding → rerank → saving', async () => {
      const { db, deps, mainWindow } = ctxWithAllStages()

      await runFetch({ db, deps, mainWindow })

      const stages = progressEvents(mainWindow).map(e => e.stage)
      expect([...new Set(stages)]).toEqual(['arxiv', 'embedding', 'rerank', 'saving'])
    })

    it('bookends every stage with a start and an end event so the bar never stalls', async () => {
      const { db, deps, mainWindow } = ctxWithAllStages()

      await runFetch({ db, deps, mainWindow })

      const events = progressEvents(mainWindow)
      for (const stage of ['embedding', 'rerank', 'saving']) {
        const of = events.filter(e => e.stage === stage)
        expect(of[0].current).toBe(0)
        expect(of[of.length - 1].current).toBe(of[of.length - 1].total)
      }
    })

    it('counts saved papers against maxPapers in the saving stage', async () => {
      const papers = Array.from({ length: 3 }, (_, i) => ({ ...PAPER, id: `p${i}` }))
      const { db, deps, mainWindow } = makeCtx({
        settings: { maxPapers: '2' },
        deps: { fetchPapers: vi.fn().mockResolvedValue(papers) },
      })

      await runFetch({ db, deps, mainWindow })

      const saving = progressEvents(mainWindow).filter(e => e.stage === 'saving')
      expect(saving[saving.length - 1]).toEqual({ stage: 'saving', current: 2, total: 2 })
    })

    it('still works when there is no window (scheduler without UI)', async () => {
      const { db, deps } = makeCtx()

      await expect(runFetch({ db, deps, mainWindow: null })).resolves.toBeDefined()
    })
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

  it('marks the entry for a paper saved despite not matching the org filter, including the AI-detected affiliation', async () => {
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
    const unmatched = report.entries.find(e => e.id === 'p1')
    expect(unmatched).toMatchObject({ decision: 'saved', stage: 'saved' })
    expect(unmatched.orgFilter).toMatchObject({ passed: false })
    expect(unmatched.university).toContain('Harvard')
  })

  it('marks a saved entry with a plain "Guardado" reason — no more "fallback" wording', async () => {
    const { db, deps, mainWindow } = makeCtx({
      llm: { extractAffiliationsWithAI: vi.fn().mockResolvedValue(['Harvard']) },
    })

    await runFetch({ db, deps, mainWindow })

    const report = deps.writeFetchLog.mock.calls[0][0]
    expect(report.entries[0]).toMatchObject({ decision: 'saved', stage: 'saved' })
    expect(report.entries[0].reason).not.toMatch(/fallback/i)
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

// ─── OCR automático de los papers recién guardados ────────────────────────────
// Resumen, quiz, clase y chat exigen OCR, así que el fetch lo corre solo sobre los
// papers que acaba de guardar (antes era una acción manual: regla OCR-002, ya derogada).

describe('runFetch — OCR automático de los papers guardados', () => {
  const llamaParseSettings = { ocrEngine: 'llamaparse', llamaParseApiKey: 'llx-test' }
  const manyPapers = (n) => Array.from({ length: n }, (_, i) => ({ ...PAPER, id: `new${i}` }))

  it('saves ingested papers first with the basic text (pdf-parse)', async () => {
    const { db, deps, mainWindow } = makeCtx()

    await runFetch({ db, deps, mainWindow })

    expect(db.savePaper).toHaveBeenCalledWith(expect.objectContaining({ pdf_text_source: 'pdf-parse' }))
  })

  it('runs OCR on every saved paper and stores the OCR text as the paper text', async () => {
    const { db, deps, mainWindow } = makeCtx({
      settings: { ...llamaParseSettings, maxPapers: '3' },
      deps: { fetchPapers: vi.fn().mockResolvedValue(manyPapers(2)) },
    })

    await runFetch({ db, deps, mainWindow })

    expect(deps.parsePdfWithLlamaParse).toHaveBeenCalledTimes(2)
    expect(deps.parsePdfWithLlamaParse.mock.calls[0][0]).toBeInstanceOf(Buffer)
    expect(db.savePaper).toHaveBeenCalledWith(expect.objectContaining({ id: 'new0', pdf_text: '# LlamaParse OCR', pdf_text_source: 'ocr' }))
    expect(db.savePaper).toHaveBeenCalledWith(expect.objectContaining({ id: 'new1', pdf_text: '# LlamaParse OCR', pdf_text_source: 'ocr' }))
    expect(deps.vault.writeOcr).toHaveBeenCalledTimes(2)
  })

  it('returns the papers with their OCR text, so the UI sees them as ready', async () => {
    const { db, deps, mainWindow } = makeCtx({ settings: llamaParseSettings })

    const result = await runFetch({ db, deps, mainWindow })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ pdf_text: '# LlamaParse OCR', pdf_text_source: 'ocr' })
  })

  it('uses the vision model when that is the chosen engine', async () => {
    const { db, deps, mainWindow } = makeCtx({
      settings: { ocrEngine: 'vision' },
      llm: { extractAffiliationsWithAI: vi.fn().mockResolvedValue(['MIT']), transcribePageToMarkdown: vi.fn() },
    })

    await runFetch({ db, deps, mainWindow })

    expect(deps.transcribePdfToMarkdown).toHaveBeenCalledOnce()
    expect(deps.parsePdfWithLlamaParse).not.toHaveBeenCalled()
  })

  it('a failed OCR does not fail the fetch: the paper stays saved with the basic text and the error recorded', async () => {
    const { db, deps, mainWindow } = makeCtx({
      settings: llamaParseSettings,
      deps: { parsePdfWithLlamaParse: vi.fn().mockResolvedValue({ success: false, error: 'LlamaParse: sin créditos' }) },
    })

    const result = await runFetch({ db, deps, mainWindow })

    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(1)
    expect(result[0].pdf_text_source).toBe('pdf-parse')
    expect(db.savePaper).toHaveBeenCalledWith(expect.objectContaining({ ocr_error: 'LlamaParse: sin créditos' }))
  })

  it('when OCR is impossible (provider without vision) the fetch still succeeds untouched', async () => {
    const { db, deps, mainWindow } = makeCtx() // el LLM por defecto no tiene visión

    const result = await runFetch({ db, deps, mainWindow })

    expect(result).toHaveLength(1)
    expect(deps.transcribePdfToMarkdown).not.toHaveBeenCalled()
    expect(deps.parsePdfWithLlamaParse).not.toHaveBeenCalled()
    expect(result[0].pdf_text_source).toBe('pdf-parse')
  })

  it('one failing OCR does not stop the next papers', async () => {
    const parse = vi.fn()
      .mockResolvedValueOnce({ success: false, error: 'timeout' })
      .mockResolvedValue({ success: true, markdown: '# ok', pageCount: 1 })
    const { db, deps, mainWindow } = makeCtx({
      settings: { ...llamaParseSettings, maxPapers: '3' },
      deps: { fetchPapers: vi.fn().mockResolvedValue(manyPapers(2)), parsePdfWithLlamaParse: parse },
    })

    const result = await runFetch({ db, deps, mainWindow })

    expect(result.map(p => p.pdf_text_source)).toEqual(['pdf-parse', 'ocr'])
  })

  it('does not OCR papers that were not saved', async () => {
    const { db, deps, mainWindow } = makeCtx({
      settings: llamaParseSettings,
      deps: { downloadPdf: vi.fn().mockResolvedValue({ success: false, error: 'timeout' }) },
    })

    await runFetch({ db, deps, mainWindow })

    expect(deps.parsePdfWithLlamaParse).not.toHaveBeenCalled()
  })

  it('reports an ocr progress stage, started at 0 and ended at the number of papers', async () => {
    const { db, deps, mainWindow } = makeCtx({ settings: llamaParseSettings })

    await runFetch({ db, deps, mainWindow })

    const ocr = mainWindow.webContents.send.mock.calls.filter(c => c[0] === 'fetch-progress' && c[1].stage === 'ocr').map(c => c[1])
    expect(ocr[0]).toEqual({ stage: 'ocr', current: 0, total: 1 })
    expect(ocr[ocr.length - 1]).toEqual({ stage: 'ocr', current: 1, total: 1 })
  })

  it('notes the OCR outcome in the fetch log', async () => {
    const { db, deps, mainWindow } = makeCtx({ settings: llamaParseSettings })

    await runFetch({ db, deps, mainWindow })

    const report = deps.writeFetchLog.mock.calls[0][0]
    expect(report.entries[0].reason).toMatch(/OCR/)
  })
})
