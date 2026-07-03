const fs   = require('fs')
const path = require('path')
const { createOpenAIEmbeddingProvider } = require('./providers/openai')

function createEmbeddings(settings) {
  const provider = settings.embeddingProvider || 'openai'
  const apiKey   = settings.openaiApiKey || settings.apiKey
  const model    = settings.embeddingModel || undefined
  switch (provider) {
    default: return createOpenAIEmbeddingProvider(apiKey, model ? { model } : {})
  }
}

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

async function indexReferenceFolder(folderPath, db, provider, pdfParse, llm = null) {
  if (!folderPath || !fs.existsSync(folderPath)) return { indexed: 0, errors: 0 }

  const files = fs.readdirSync(folderPath).filter(f => f.toLowerCase().endsWith('.pdf'))
  let indexed = 0, errors = 0

  for (const file of files) {
    const filePath = path.join(folderPath, file)
    if (db.getReferencePaper(filePath)) continue

    try {
      const buf      = fs.readFileSync(filePath)
      const { text } = await pdfParse(buf)
      const snippet  = text.slice(0, 3000)
      const embedding = await provider.generateEmbedding(snippet)
      const abstract_summary = llm ? await llm.summarizeAbstract(snippet) : null
      db.saveReferencePaper({ path: filePath, snippet, embedding: JSON.stringify(embedding), abstract_summary })
      indexed++
      console.log(`[embeddings] Indexed: ${file}`)
    } catch (err) {
      console.error(`[embeddings] Error indexing ${file}: ${err.message}`)
      errors++
    }
  }

  return { indexed, errors }
}

// Pure — max cosine similarity against a set of precomputed embeddings.
// Split out from scoreAbstractAgainst so a single abstract embedding can be
// scored against both the reference collection and the user's keywordList
// without re-embedding it twice.
function scoreEmbeddingAgainst(embedding, refEmbeddings) {
  let max = 0
  for (const refEmb of refEmbeddings) {
    const score = cosineSimilarity(embedding, refEmb)
    if (score > max) max = score
  }
  return max
}

async function scoreAbstractAgainst(abstract, refEmbeddings, provider) {
  const emb = await provider.generateEmbedding(abstract)
  return scoreEmbeddingAgainst(emb, refEmbeddings)
}

// Embeds each line of settings.keywordList once, so callers can reuse the
// vectors across a whole fetch run instead of re-embedding per candidate.
async function embedKeywordList(keywordListRaw, provider) {
  const keywords = (keywordListRaw || '').split('\n').map(s => s.trim()).filter(Boolean)
  const result = []
  for (const keyword of keywords) {
    const embedding = await provider.generateEmbedding(keyword)
    result.push({ keyword, embedding })
  }
  return result
}

async function indexFiles(filePaths, db, provider, pdfParse, llm = null) {
  let indexed = 0, errors = 0
  for (const filePath of filePaths) {
    if (!filePath.toLowerCase().endsWith('.pdf')) continue
    if (db.getReferencePaper(filePath)) continue

    try {
      const buf      = fs.readFileSync(filePath)
      const { text } = await pdfParse(buf)
      const snippet  = text.slice(0, 3000)
      const embedding = await provider.generateEmbedding(snippet)
      const abstract_summary = llm ? await llm.summarizeAbstract(snippet) : null
      db.saveReferencePaper({ path: filePath, snippet, embedding: JSON.stringify(embedding), abstract_summary })
      indexed++
      console.log(`[embeddings] Indexed: ${path.basename(filePath)}`)
    } catch (err) {
      console.error(`[embeddings] Error indexing ${path.basename(filePath)}: ${err.message}`)
      errors++
    }
  }
  return { indexed, errors }
}

module.exports = {
  createEmbeddings, cosineSimilarity, indexReferenceFolder, indexFiles,
  scoreAbstractAgainst, scoreEmbeddingAgainst, embedKeywordList,
}