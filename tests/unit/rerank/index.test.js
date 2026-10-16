import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createReranker } from '../../../src/rerank/index.js'

// The real cross-encoder (@xenova/transformers) is never loaded in tests —
// a scorer function is injected instead, same "injectable client" pattern
// used by the LLM and embeddings providers.

describe('createReranker — rerank', () => {
  it('returns [] when documents is empty', async () => {
    const scorer = vi.fn()
    const reranker = createReranker(scorer)
    const result = await reranker.rerank('my interest profile', [])
    expect(result).toEqual([])
    expect(scorer).not.toHaveBeenCalled()
  })

  it('returns [] when documents is null/undefined', async () => {
    const reranker = createReranker(vi.fn())
    expect(await reranker.rerank('query', null)).toEqual([])
    expect(await reranker.rerank('query', undefined)).toEqual([])
  })

  it('calls the scorer once per document with (query, document)', async () => {
    const scorer = vi.fn().mockResolvedValue(0.5)
    const reranker = createReranker(scorer)
    await reranker.rerank('profile text', ['abstract A', 'abstract B'])
    expect(scorer).toHaveBeenCalledTimes(2)
    expect(scorer).toHaveBeenCalledWith('profile text', 'abstract A')
    expect(scorer).toHaveBeenCalledWith('profile text', 'abstract B')
  })

  it('returns results sorted by score descending', async () => {
    const scorer = vi.fn()
      .mockResolvedValueOnce(0.2)
      .mockResolvedValueOnce(0.9)
      .mockResolvedValueOnce(0.5)
    const reranker = createReranker(scorer)
    const result = await reranker.rerank('q', ['low', 'high', 'mid'])
    expect(result.map(r => r.score)).toEqual([0.9, 0.5, 0.2])
  })

  it('preserves the original document index so callers can map back', async () => {
    const scorer = vi.fn()
      .mockResolvedValueOnce(0.1)
      .mockResolvedValueOnce(0.9)
    const reranker = createReranker(scorer)
    const result = await reranker.rerank('q', ['doc0', 'doc1'])
    expect(result).toEqual([
      { index: 1, score: 0.9 },
      { index: 0, score: 0.1 },
    ])
  })
})

// ─── multiple queries ─────────────────────────────────────────────────────────
// One query concatenating every reference summary + keyword overflowed the
// cross-encoder's token limit, so truncation cut the tail (the user's declared
// keywords) and every candidate was judged against the same head of the text.
// Instead each interest is its own short query and a document keeps its best score.

describe('createReranker — multiple queries', () => {
  it('scores every (query, document) pair', async () => {
    const scorer = vi.fn().mockResolvedValue(0.5)
    const reranker = createReranker(scorer)

    await reranker.rerank(['q1', 'q2'], ['A', 'B'])

    expect(scorer).toHaveBeenCalledTimes(4)
    expect(scorer).toHaveBeenCalledWith('q1', 'A')
    expect(scorer).toHaveBeenCalledWith('q2', 'B')
  })

  it('keeps the BEST score across queries for each document', async () => {
    // doc0 matches q2 well, doc1 matches q1 well
    const table = { 'q1|doc0': 0.1, 'q2|doc0': 0.8, 'q1|doc1': 0.6, 'q2|doc1': 0.2 }
    const scorer = vi.fn().mockImplementation(async (q, d) => table[`${q}|${d}`])
    const reranker = createReranker(scorer)

    const result = await reranker.rerank(['q1', 'q2'], ['doc0', 'doc1'])

    expect(result).toEqual([
      { index: 0, score: 0.8 },
      { index: 1, score: 0.6 },
    ])
  })

  it('still accepts a single string query', async () => {
    const scorer = vi.fn().mockResolvedValue(0.3)
    const result = await createReranker(scorer).rerank('only', ['d'])

    expect(result).toEqual([{ index: 0, score: 0.3 }])
    expect(scorer).toHaveBeenCalledWith('only', 'd')
  })

  it('ignores blank queries; with none left it keeps the original order at score 0', async () => {
    const scorer = vi.fn()
    const result = await createReranker(scorer).rerank(['', '  '], ['a', 'b'])

    expect(scorer).not.toHaveBeenCalled()
    expect(result).toEqual([{ index: 0, score: 0 }, { index: 1, score: 0 }])
  })
})

// ─── real model wiring (mocked @xenova/transformers) ──────────────────────────
//
// createReranker(_scorer) with no injected scorer exercises loadScorer(),
// which drives the real @xenova/transformers tokenizer/model directly. This
// regression-tests the *shape* of that call: the generic pipeline('text-
// classification', ...) helper does NOT forward text_pair to the tokenizer
// (it only tokenizes a single `texts` argument), so calling it with
// `{ text, text_pair }` throws "text.split is not a function" instead of
// scoring the pair. The fix loads AutoTokenizer/AutoModelForSequenceClassification
// directly and calls `tokenizer(query, { text_pair: document })`.

describe('createReranker — real model wiring', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('calls tokenizer(query, { text_pair: document }) and scores via sigmoid(logit)', async () => {
    const tokenizerFn = vi.fn().mockReturnValue({ input_ids: [1, 2, 3] })
    const modelFn = vi.fn().mockResolvedValue({ logits: { data: [2] } })

    vi.doMock('@xenova/transformers', () => ({
      AutoTokenizer: { from_pretrained: vi.fn().mockResolvedValue(tokenizerFn) },
      AutoModelForSequenceClassification: { from_pretrained: vi.fn().mockResolvedValue(modelFn) },
    }))

    const { createReranker } = await import('../../../src/rerank/index.js')
    const reranker = createReranker() // no injected scorer -> exercises loadScorer()
    const result = await reranker.rerank('my query', ['doc a'])

    expect(tokenizerFn).toHaveBeenCalledWith('my query', expect.objectContaining({ text_pair: 'doc a' }))
    expect(modelFn).toHaveBeenCalledWith(tokenizerFn.mock.results[0].value)
    expect(result[0].score).toBeCloseTo(1 / (1 + Math.exp(-2)))
  })
})
