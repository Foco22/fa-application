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

const FETCH_PAGE_SIZE = 100  // candidates per ArXiv request
const FETCH_POOL_CAP  = 300  // defensive cap on total candidates per run (not a design target)

const MAX_RETRIES        = 3     // total attempts per page request
const RETRY_BASE_DELAY_MS = 1000 // 1s, 2s, ... (linear backoff)

function defaultSleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ArXiv's search backend is flaky/slow on submittedDate-range queries and
// intermittently answers with a 503 under load. Bare network errors (no
// `response`, e.g. timeouts/ECONNRESET) are just as transient. 4xx errors
// mean the query itself is wrong — retrying won't help.
function isRetryable(err) {
  if (!err.response) return true
  return err.response.status >= 500
}

// Turns a raw axios/network error into a message that tells the user WHERE
// the failure is (ArXiv's service, not their settings) and whether it's
// worth retrying — instead of surfacing axios' generic "Request failed
// with status code 503".
function describeFetchError(err, attempts) {
  if (err.response && err.response.status < 500) {
    return `ArXiv rechazó la consulta (${err.response.status}): ${err.message}`
  }
  if (err.response) {
    return `El servicio de ArXiv respondió con error ${err.response.status} tras ${attempts} intento(s). ` +
      `Parece un problema temporal / caída del lado de ArXiv, no de tu configuración — probá de nuevo en unos minutos.`
  }
  return `No se pudo conectar con ArXiv tras ${attempts} intento(s) (${err.message}). ` +
    `Puede ser un problema de conexión/red o que el servicio esté no disponible — probá de nuevo en unos minutos.`
}

// Paginates through ArXiv results for the whole weekly window instead of
// cutting at a fixed number — sorting by submittedDate desc + a fixed
// max_results would systematically drop early-week papers once a broad
// category selection exceeds one page.
async function fetchPapers(settings, httpClient, today = new Date(), sleepFn = defaultSleep) {
  const { categoryList, authorList } = settings

  let query
  try {
    const window = calculateDateWindow(today)
    query = buildQuery({ categoryList, authorList }, window)
  } catch (err) {
    return { error: err.message }
  }

  const all = []
  let start = 0

  try {
    while (all.length < FETCH_POOL_CAP) {
      const pageSize = Math.min(FETCH_PAGE_SIZE, FETCH_POOL_CAP - all.length)
      const url = `${ARXIV_API}?search_query=${encodeURIComponent(query)}&sortBy=submittedDate&sortOrder=descending&start=${start}&max_results=${pageSize}`

      let page
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const response = await httpClient.get(url)
          page = parseFeed(response.data)
          break
        } catch (err) {
          if (!isRetryable(err) || attempt === MAX_RETRIES) {
            throw new Error(describeFetchError(err, attempt))
          }
          console.warn(`[arxiv] request failed (attempt ${attempt}/${MAX_RETRIES}): ${err.message}. Retrying...`)
          await sleepFn(RETRY_BASE_DELAY_MS * attempt)
        }
      }

      all.push(...page)
      if (page.length < pageSize) break // fewer than requested → window exhausted
      start += pageSize
    }
  } catch (err) {
    return { error: err.message }
  }

  return all
}

module.exports = { calculateDateWindow, buildQuery, parseFeed, fetchPapers, FETCH_PAGE_SIZE, FETCH_POOL_CAP, MAX_RETRIES }