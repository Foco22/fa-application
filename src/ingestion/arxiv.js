const { XMLParser } = require('fast-xml-parser')

const ARXIV_API = 'http://export.arxiv.org/api/query'

function calculateDateWindow(today = new Date()) {
  const dayOfWeek = today.getDay() // 0=Sun, 1=Mon ... 6=Sat
  const daysBack = ((dayOfWeek + 6) % 7) + 7

  const lastMonday = new Date(today)
  lastMonday.setDate(today.getDate() - daysBack)

  const lastSunday = new Date(lastMonday)
  lastSunday.setDate(lastMonday.getDate() + 6)

  return {
    from: formatDate(lastMonday),
    to:   formatDate(lastSunday)
  }
}

function formatDate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

function buildQuery({ categoryList, authorList }, { from, to }) {
  const cats    = categoryList ? categoryList.split(',').map(s => s.trim()).filter(Boolean) : []
  const authors = authorList   ? authorList.split('\n').map(s => s.trim()).filter(Boolean) : []

  if (cats.length === 0 && authors.length === 0) {
    throw new Error('Query is empty: configure at least one category or author')
  }

  const parts = [`submittedDate:[${from}0000 TO ${to}2359]`]

  if (cats.length > 0) {
    parts.push(`(${cats.map(c => `cat:${c}`).join(' OR ')})`)
  }
  if (authors.length > 0) {
    parts.push(`(${authors.map(a => `au:${a}`).join(' OR ')})`)
  }

  return parts.join(' AND ')
}

function parseFeed(xml) {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })
  const doc = parser.parse(xml)
  const feed = doc.feed || {}

  let entries = feed.entry || []
  if (!Array.isArray(entries)) entries = [entries]

  return entries.map(entry => {
    const rawId = entry.id || ''
    const arxivId = rawId.replace(/.*\/abs\//, '').replace(/v\d+$/, '')

    let authors = []
    if (entry.author) {
      const raw = Array.isArray(entry.author) ? entry.author : [entry.author]
      authors = raw.map(a => a.name).filter(Boolean)
    }

    let pdfUrl = ''
    if (entry.link) {
      const links = Array.isArray(entry.link) ? entry.link : [entry.link]
      const pdfLink = links.find(l => l['@_title'] === 'pdf')
      if (pdfLink) pdfUrl = pdfLink['@_href'] || ''
    }

    return {
      id:             arxivId,
      title:          (entry.title || '').trim(),
      abstract:       (entry.summary || '').trim(),
      authors:        authors.join(', '),
      published_date: entry.published || '',
      pdf_url:        pdfUrl,
      affiliations:   JSON.stringify([]),
      pdf_text:       null,
      summary:        null,
      quiz:           null,
      pdf_error:      null,
      status:         'new'
    }
  })
}

const FETCH_POOL = 50  // candidates fetched from ArXiv; maxPapers applied after filtering

async function fetchPapers(settings, httpClient, today = new Date()) {
  const { categoryList, authorList } = settings

  let query
  try {
    const window = calculateDateWindow(today)
    query = buildQuery({ categoryList, authorList }, window)
  } catch (err) {
    return { error: err.message }
  }

  const url = `${ARXIV_API}?search_query=${encodeURIComponent(query)}&sortBy=submittedDate&sortOrder=descending&max_results=${FETCH_POOL}`

  try {
    const response = await httpClient.get(url)
    return parseFeed(response.data)
  } catch (err) {
    return { error: err.message }
  }
}

module.exports = { calculateDateWindow, buildQuery, parseFeed, fetchPapers }