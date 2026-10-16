const MODEL_ID = 'mixedbread-ai/mxbai-rerank-xsmall-v1'

let cachedScorerPromise = null

// Lazily loads the local cross-encoder the first time it's needed and caches
// it — the model is downloaded once by @xenova/transformers and cached on
// disk, no bundling in the electron-builder installers.
//
// Cross-encoder rerank models score a (query, document) pair jointly and
// need `text_pair` forwarded to the tokenizer — the generic `pipeline('text-
// classification', ...)` helper does NOT support this (its `_call` only
// tokenizes a single `texts` argument), so the tokenizer/model are loaded
// and driven directly instead. mxbai-rerank-xsmall-v1 has a single output
// label (regression-style relevance logit, not a class distribution), so
// the score is the sigmoid of that raw logit.
function loadScorer() {
  if (!cachedScorerPromise) {
    cachedScorerPromise = (async () => {
      const { AutoTokenizer, AutoModelForSequenceClassification } = await import('@xenova/transformers')
      const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID)
      const model = await AutoModelForSequenceClassification.from_pretrained(MODEL_ID)
      return async (query, document) => {
        const inputs = tokenizer(query, { text_pair: document, padding: true, truncation: true })
        const { logits } = await model(inputs)
        const raw = logits.data[0]
        return 1 / (1 + Math.exp(-raw))
      }
    })()
  }
  return cachedScorerPromise
}

// _scorer: injectable (query, document) => Promise<number>, same pattern as
// the LLM/embeddings provider clients — tests never load the real model.
//
// `query` may be a string or an array of strings. The cross-encoder truncates
// (query + document) at its token limit, so a single query that concatenates
// every interest gets its tail cut off. With an array, each interest is scored
// on its own and a document keeps its best score (same max-pooling idea as the
// embedding similarity). Cost: queries × documents inferences — local and free.
function createReranker(_scorer = null) {
  return {
    async rerank(query, documents) {
      if (!documents || documents.length === 0) return []

      const queries = (Array.isArray(query) ? query : [query]).filter(q => q && q.trim())
      if (queries.length === 0) return documents.map((_, index) => ({ index, score: 0 }))

      const scorer = _scorer || await loadScorer()

      const scored = []
      for (let i = 0; i < documents.length; i++) {
        let best = -Infinity
        for (const q of queries) {
          const score = await scorer(q, documents[i])
          if (score > best) best = score
        }
        scored.push({ index: i, score: best })
      }
      return scored.sort((a, b) => b.score - a.score)
    }
  }
}

module.exports = { createReranker }
