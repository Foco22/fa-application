const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'when', 'at', 'by',
  'for', 'with', 'about', 'against', 'between', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down', 'in', 'out',
  'on', 'off', 'over', 'under', 'again', 'further', 'once', 'here', 'there',
  'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such',
  'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
  'can', 'will', 'just', 'should', 'now', 'is', 'are', 'was', 'were', 'be',
  'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing',
  'of', 'it', 'its', 'this', 'that', 'these', 'those', 'we', 'our', 'their',
  'they', 'which', 'who', 'whom', 'as', 'also', 'i', 'you', 'he', 'she',
])

function tokenizePhrases(text) {
  const sentences = text.toLowerCase().split(/[.!?;,()[\]{}:"“”\n]+/)
  const phrases = []

  for (const sentence of sentences) {
    const words = sentence.split(/\s+/).filter(Boolean)
    let current = []
    for (const raw of words) {
      const word = raw.replace(/[^a-z0-9-]/g, '')
      if (!word) continue
      if (STOPWORDS.has(word)) {
        if (current.length) { phrases.push(current); current = [] }
      } else {
        current.push(word)
      }
    }
    if (current.length) phrases.push(current)
  }

  return phrases
}

// Lightweight RAKE-style extraction: no external deps, no API calls.
// Scores each candidate phrase by how often its words appear and how often
// they co-occur inside longer phrases, then returns the top phrases.
function extractKeywords(text, maxKeywords = 8) {
  if (!text || !text.trim()) return []

  const phrases = tokenizePhrases(text)
  if (phrases.length === 0) return []

  const freq = new Map()
  const degree = new Map()
  for (const phrase of phrases) {
    const coOccurrence = phrase.length - 1
    for (const word of phrase) {
      freq.set(word, (freq.get(word) || 0) + 1)
      degree.set(word, (degree.get(word) || 0) + coOccurrence)
    }
  }

  const phraseScores = new Map()
  for (const phrase of phrases) {
    const key = phrase.join(' ')
    const score = phrase.reduce((sum, word) => sum + degree.get(word) + freq.get(word), 0)
    if (!phraseScores.has(key) || phraseScores.get(key) < score) {
      phraseScores.set(key, score)
    }
  }

  return [...phraseScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxKeywords)
    .map(([phrase]) => phrase)
}

// Literal (lexical) match — the other half of hybrid search alongside embeddings.
function keywordOverlap(text, keywords) {
  if (!text || !keywords || keywords.length === 0) return false
  const lower = text.toLowerCase()
  return keywords
    .map(k => (k || '').trim().toLowerCase())
    .filter(Boolean)
    .some(k => lower.includes(k))
}

module.exports = { extractKeywords, keywordOverlap }
