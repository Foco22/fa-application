
const MAX_CHARS = 30000

async function extractText(buffer, pdfParse) {
  try {
    const { text } = await pdfParse(buffer)

    if (!text || !text.trim()) {
      return { success: false, error: 'PDF parsed but no text content found' }
    }

    return { success: true, text: text.slice(0, MAX_CHARS) }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

async function extractFirstPage(buffer, pdfParse) {
  try {
    const { text } = await pdfParse(buffer)
    return { success: true, text: text.slice(0, 5000) }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

// Keywords that identify affiliation lines in a paper's first page
const AFFIL_KEYWORDS = [
  'university', 'institute', 'college', 'school of', 'department',
  'laboratory', 'polytechnic', 'academia', 'faculty', 'center for',
  'centre for', 'eth zurich', 'epfl', 'mit ', 'caltech',
]

function extractAffiliationLines(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const result = []
  for (const line of lines) {
    const lower = line.toLowerCase()
    if (!AFFIL_KEYWORDS.some(kw => lower.includes(kw))) continue
    const clean = line
      .replace(/^\d+\s*/, '')              // leading superscript number
      .replace(/\s*\{[^}]+\}[^\s]*/g, '') // {name}@domain emails
      .replace(/\s+\S+@\S+\s*$/, '')      // trailing bare email
      .trim()
    if (clean.length > 5 && !clean.includes('@')) result.push(clean)
  }
  return result
}

function matchesUniversityInText(text, universityList) {
  const affiliLines = extractAffiliationLines(text)
  // Only match against actual affiliation lines, not arbitrary PDF text
  for (const line of affiliLines) {
    const lower = line.toLowerCase()
    const matched = universityList.find(uni => lower.includes(uni.toLowerCase()))
    if (matched) return matched
  }
  return null
}

module.exports.extractAffiliationLines = extractAffiliationLines

module.exports = { extractText, extractFirstPage, matchesUniversityInText }
