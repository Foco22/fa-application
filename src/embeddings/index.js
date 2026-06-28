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

async function indexReferenceFolder(folderPath, db, provider, pdfParse) {
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
      db.saveReferencePaper({ path: filePath, snippet, embedding: JSON.stringify(embedding) })
      indexed++
      console.log(`[embeddings] Indexed: ${file}`)
    } catch (err) {
      console.error(`[embeddings] Error indexing ${file}: ${err.message}`)
      errors++
    }
  }

  return { indexed, errors }
}

async function scoreAbstractAgainst(abstract, refEmbeddings, provider) {
  const emb = await provider.generateEmbedding(abstract)
  let max = 0
  for (const refEmb of refEmbeddings) {
    const score = cosineSimilarity(emb, refEmb)
    if (score > max) max = score
  }
  return max
}

async function indexFiles(filePaths, db, provider, pdfParse) {
  let indexed = 0, errors = 0
  for (const filePath of filePaths) {
    if (!filePath.toLowerCase().endsWith('.pdf')) continue
    if (db.getReferencePaper(filePath)) continue

    try {
      const buf      = fs.readFileSync(filePath)
      const { text } = await pdfParse(buf)
      const snippet  = text.slice(0, 3000)
      const embedding = await provider.generateEmbedding(snippet)
      db.saveReferencePaper({ path: filePath, snippet, embedding: JSON.stringify(embedding) })
      indexed++
      console.log(`[embeddings] Indexed: ${path.basename(filePath)}`)
    } catch (err) {
      console.error(`[embeddings] Error indexing ${path.basename(filePath)}: ${err.message}`)
      errors++
    }
  }
  return { indexed, errors }
}

module.exports = { createEmbeddings, cosineSimilarity, indexReferenceFolder, indexFiles, scoreAbstractAgainst }