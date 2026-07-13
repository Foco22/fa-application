import { describe, it, expect, vi } from 'vitest'
import { calculateDateWindow, buildQuery, parseFeed, fetchPapers, FETCH_PAGE_SIZE, FETCH_POOL_CAP, MAX_RETRIES } from '../../../src/ingestion/arxiv.js'

// no-op sleep so retry tests don't wait on real backoff delays
const fastSleep = () => Promise.resolve()

function httpError(status) {
  const err = new Error(`Request failed with status code ${status}`)
  err.response = { status }
  return err
}

// ─── fixture: minimal ArXiv Atom feed ────────────────────────────────────────

const FEED_ONE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2401.00001v1</id>
    <title>Attention Is All You Need Again</title>
    <summary>We propose a new architecture.</summary>
    <published>2024-01-09T00:00:00Z</published>
    <author><name>Alice Smith</name></author>
    <author><name>Bob Jones</name></author>
    <link title="pdf" href="http://arxiv.org/pdf/2401.00001v1" rel="related"/>
  </feed>
</feed>`

const FEED_EMPTY = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
</feed>`

const FEED_TWO = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2401.00001v1</id>
    <title>Paper One</title>
    <summary>Abstract one.</summary>
    <published>2024-01-09T00:00:00Z</published>
    <author><name>Alice Smith</name></author>
    <link title="pdf" href="http://arxiv.org/pdf/2401.00001v1" rel="related"/>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2401.00002v1</id>
    <title>Paper Two</title>
    <summary>Abstract two.</summary>
    <published>2024-01-10T00:00:00Z</published>
    <author><name>Carol White</name></author>
    <link title="pdf" href="http://arxiv.org/pdf/2401.00002v1" rel="related"/>
  </entry>
</feed>`

// ─── calculateDateWindow ──────────────────────────────────────────────────────

// Las fechas se construyen con new Date(y, m, d) —fecha LOCAL— y no con
// new Date('2025-06-16'), que JS parsea como medianoche UTC: en una zona
// negativa (Chile, UTC−4) eso es el día anterior y el test decía "lunes"
// mientras le pasaba un domingo. En producción la función recibe new Date(),
// que ya es local, así que el bug era del test, no del código.
describe('calculateDateWindow', () => {
  it('returns last Mon→Sun when today is Monday', () => {
    // Monday 2025-06-16
    const { from, to } = calculateDateWindow(new Date(2025, 5, 16))
    expect(from).toBe('20250609')
    expect(to).toBe('20250615')
  })

  it('returns last Mon→Sun when today is Wednesday (mid-week)', () => {
    // Wednesday 2025-06-18
    const { from, to } = calculateDateWindow(new Date(2025, 5, 18))
    expect(from).toBe('20250609')
    expect(to).toBe('20250615')
  })

  it('returns last Mon→Sun when today is Sunday', () => {
    // Sunday 2025-06-22
    const { from, to } = calculateDateWindow(new Date(2025, 5, 22))
    expect(from).toBe('20250609')
    expect(to).toBe('20250615')
  })

  it('returns last Mon→Sun when today is Saturday', () => {
    // Saturday 2025-06-21
    const { from, to } = calculateDateWindow(new Date(2025, 5, 21))
    expect(from).toBe('20250609')
    expect(to).toBe('20250615')
  })

  it('output strings are exactly 8 digits (YYYYMMDD)', () => {
    const { from, to } = calculateDateWindow(new Date(2025, 5, 16))
    expect(from).toMatch(/^\d{8}$/)
    expect(to).toMatch(/^\d{8}$/)
  })

  it('from is always 6 days before to', () => {
    const { from, to } = calculateDateWindow(new Date(2025, 5, 16))
    const fromDate = new Date(`${from.slice(0,4)}-${from.slice(4,6)}-${from.slice(6,8)}`)
    const toDate   = new Date(`${to.slice(0,4)}-${to.slice(4,6)}-${to.slice(6,8)}`)
    const diffDays = (toDate - fromDate) / (1000 * 60 * 60 * 24)
    expect(diffDays).toBe(6)
  })
})

// ─── buildQuery ───────────────────────────────────────────────────────────────

describe('buildQuery', () => {
  const window = { from: '20250609', to: '20250615' }

  it('includes the submittedDate range', () => {
    const q = buildQuery({ categoryList: 'cs.AI', authorList: '' }, window)
    expect(q).toContain('submittedDate:[202506090000 TO 202506152359]')
  })

  it('includes category filter when categoryList is set', () => {
    const q = buildQuery({ categoryList: 'cs.AI,cs.LG', authorList: '' }, window)
    expect(q).toContain('cat:cs.AI')
    expect(q).toContain('cat:cs.LG')
  })

  it('includes author filter when authorList is set', () => {
    const q = buildQuery({ categoryList: '', authorList: 'LeCun\nBengio' }, window)
    expect(q).toContain('au:LeCun')
    expect(q).toContain('au:Bengio')
  })

  it('combines categories AND authors when both are set', () => {
    const q = buildQuery({ categoryList: 'cs.AI', authorList: 'LeCun' }, window)
    expect(q).toContain('cat:cs.AI')
    expect(q).toContain('au:LeCun')
    // both parts must appear (AND logic)
    expect(q.toLowerCase()).toContain('and')
  })

  it('throws when both categoryList and authorList are empty', () => {
    expect(() => buildQuery({ categoryList: '', authorList: '' }, window))
      .toThrow('empty')
  })

  it('ignores blank lines in authorList', () => {
    const q = buildQuery({ categoryList: '', authorList: 'LeCun\n\nBengio\n' }, window)
    expect(q).toContain('au:LeCun')
    expect(q).toContain('au:Bengio')
    expect((q.match(/au:/g) || []).length).toBe(2) // exactly two, no blank entry
  })
})

// ─── parseFeed ────────────────────────────────────────────────────────────────

describe('parseFeed', () => {
  it('returns an empty array for a feed with no entries', () => {
    expect(parseFeed(FEED_EMPTY)).toEqual([])
  })

  it('parses a single entry correctly', () => {
    const papers = parseFeed(FEED_ONE)
    expect(papers).toHaveLength(1)
    const p = papers[0]
    expect(p.id).toBe('2401.00001')
    expect(p.title).toBe('Attention Is All You Need Again')
    expect(p.abstract).toBe('We propose a new architecture.')
    expect(p.published_date).toBe('2024-01-09T00:00:00Z')
    expect(p.authors).toBe('Alice Smith, Bob Jones')
    expect(p.pdf_url).toBe('http://arxiv.org/pdf/2401.00001v1')
    expect(p.status).toBe('new')
  })

  it('strips version suffix from ArXiv id', () => {
    const papers = parseFeed(FEED_ONE)
    expect(papers[0].id).toBe('2401.00001')
    expect(papers[0].id).not.toContain('v1')
  })

  it('parses multiple entries', () => {
    const papers = parseFeed(FEED_TWO)
    expect(papers).toHaveLength(2)
  })
})

// ─── fetchPapers ──────────────────────────────────────────────────────────────

// builds a synthetic Atom feed with `n` unique entries, useful for pagination tests
function makeFeed(n, offset = 0) {
  const entries = Array.from({ length: n }, (_, i) => {
    const idx = offset + i
    return `<entry>
      <id>http://arxiv.org/abs/2401.${String(idx).padStart(5, '0')}v1</id>
      <title>Paper ${idx}</title>
      <summary>Abstract ${idx}.</summary>
      <published>2024-01-09T00:00:00Z</published>
      <author><name>Author ${idx}</name></author>
      <link title="pdf" href="http://arxiv.org/pdf/2401.${String(idx).padStart(5, '0')}v1" rel="related"/>
    </entry>`
  }).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">${entries}</feed>`
}

describe('fetchPapers', () => {
  it('returns { error } when both lists are empty', async () => {
    const result = await fetchPapers(
      { categoryList: '', authorList: '' },
      null, // httpClient not needed
      new Date('2025-06-16')
    )
    expect(result.error).toBeDefined()
  })

  it('calls the ArXiv API with the correct base URL', async () => {
    const mockHttp = { get: vi.fn().mockResolvedValue({ data: FEED_ONE }) }
    await fetchPapers(
      { categoryList: 'cs.AI', authorList: '' },
      mockHttp,
      new Date('2025-06-16')
    )
    const url = mockHttp.get.mock.calls[0][0]
    expect(url).toContain('export.arxiv.org/api/query')
  })

  it('requests the first page with start=0 and the default page size', async () => {
    const mockHttp = { get: vi.fn().mockResolvedValue({ data: FEED_ONE }) }
    await fetchPapers(
      { categoryList: 'cs.AI', authorList: '' },
      mockHttp,
      new Date('2025-06-16')
    )
    const url = mockHttp.get.mock.calls[0][0]
    expect(url).toContain('start=0')
    expect(url).toContain(`max_results=${FETCH_PAGE_SIZE}`)
  })

  it('returns parsed papers on success (single, partial page)', async () => {
    const mockHttp = { get: vi.fn().mockResolvedValue({ data: FEED_TWO }) }
    const papers = await fetchPapers(
      { categoryList: 'cs.AI', authorList: '' },
      mockHttp,
      new Date('2025-06-16')
    )
    expect(Array.isArray(papers)).toBe(true)
    expect(papers).toHaveLength(2)
  })

  it('stops after one request when the page comes back smaller than the page size', async () => {
    const mockHttp = { get: vi.fn().mockResolvedValue({ data: FEED_TWO }) }
    await fetchPapers({ categoryList: 'cs.AI', authorList: '' }, mockHttp, new Date('2025-06-16'))
    expect(mockHttp.get).toHaveBeenCalledOnce()
  })

  it('paginates: requests a second page when the first page is full', async () => {
    const mockHttp = { get: vi.fn()
      .mockResolvedValueOnce({ data: makeFeed(FETCH_PAGE_SIZE, 0) })
      .mockResolvedValueOnce({ data: makeFeed(5, FETCH_PAGE_SIZE) })
    }
    const papers = await fetchPapers({ categoryList: 'cs.AI', authorList: '' }, mockHttp, new Date('2025-06-16'))
    expect(mockHttp.get).toHaveBeenCalledTimes(2)
    expect(papers).toHaveLength(FETCH_PAGE_SIZE + 5)
    const secondUrl = mockHttp.get.mock.calls[1][0]
    expect(secondUrl).toContain(`start=${FETCH_PAGE_SIZE}`)
  })

  it('stops at the defensive pool cap even if pages keep coming back full', async () => {
    const mockHttp = { get: vi.fn().mockImplementation((url) => {
      const start = parseInt(new URL(url).searchParams.get('start'), 10)
      return Promise.resolve({ data: makeFeed(FETCH_PAGE_SIZE, start) })
    }) }
    const papers = await fetchPapers({ categoryList: 'cs.AI', authorList: '' }, mockHttp, new Date('2025-06-16'))
    expect(papers).toHaveLength(FETCH_POOL_CAP)
    expect(mockHttp.get).toHaveBeenCalledTimes(FETCH_POOL_CAP / FETCH_PAGE_SIZE)
  })

  it('returns { error } when the HTTP call throws', async () => {
    const mockHttp = { get: vi.fn().mockRejectedValue(new Error('network error')) }
    const result = await fetchPapers(
      { categoryList: 'cs.AI', authorList: '' },
      mockHttp,
      new Date('2025-06-16'),
      fastSleep
    )
    expect(result.error).toContain('network error')
  })

  // ─── retry on transient (5xx / network) failures ───────────────────────────

  it('retries a 503 and succeeds once ArXiv recovers', async () => {
    const mockHttp = { get: vi.fn()
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValueOnce({ data: FEED_TWO })
    }
    const papers = await fetchPapers(
      { categoryList: 'cs.AI', authorList: '' },
      mockHttp,
      new Date('2025-06-16'),
      fastSleep
    )
    expect(mockHttp.get).toHaveBeenCalledTimes(2)
    expect(papers).toHaveLength(2)
  })

  it('retries a bare network error (no response) with backoff', async () => {
    const mockHttp = { get: vi.fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce({ data: FEED_TWO })
    }
    const papers = await fetchPapers(
      { categoryList: 'cs.AI', authorList: '' },
      mockHttp,
      new Date('2025-06-16'),
      fastSleep
    )
    expect(mockHttp.get).toHaveBeenCalledTimes(2)
    expect(papers).toHaveLength(2)
  })

  it('gives up after MAX_RETRIES consecutive 503s with an explanatory error', async () => {
    const mockHttp = { get: vi.fn().mockRejectedValue(httpError(503)) }
    const result = await fetchPapers(
      { categoryList: 'cs.AI', authorList: '' },
      mockHttp,
      new Date('2025-06-16'),
      fastSleep
    )
    expect(mockHttp.get).toHaveBeenCalledTimes(MAX_RETRIES)
    expect(result.error).toContain('503')
    expect(result.error).toContain('ArXiv')
    expect(result.error).toContain(String(MAX_RETRIES))
    expect(result.error.toLowerCase()).toMatch(/temporal|caíd|no disponible/)
  })

  it('gives up after MAX_RETRIES bare network errors with an explanatory error', async () => {
    const mockHttp = { get: vi.fn().mockRejectedValue(new Error('ECONNRESET')) }
    const result = await fetchPapers(
      { categoryList: 'cs.AI', authorList: '' },
      mockHttp,
      new Date('2025-06-16'),
      fastSleep
    )
    expect(mockHttp.get).toHaveBeenCalledTimes(MAX_RETRIES)
    expect(result.error).toContain('ArXiv')
    expect(result.error).toContain('ECONNRESET')
    expect(result.error.toLowerCase()).toMatch(/conex|red/)
  })

  it('does not retry a 4xx client error and reports it as a query problem, not a service outage', async () => {
    const mockHttp = { get: vi.fn().mockRejectedValue(httpError(400)) }
    const result = await fetchPapers(
      { categoryList: 'cs.AI', authorList: '' },
      mockHttp,
      new Date('2025-06-16'),
      fastSleep
    )
    expect(mockHttp.get).toHaveBeenCalledOnce()
    expect(result.error).toContain('400')
    expect(result.error.toLowerCase()).not.toMatch(/temporal|caíd/)
  })

  it('waits with increasing backoff between retries', async () => {
    const mockHttp = { get: vi.fn()
      .mockRejectedValueOnce(httpError(503))
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValueOnce({ data: FEED_TWO })
    }
    const sleepFn = vi.fn().mockResolvedValue()
    await fetchPapers(
      { categoryList: 'cs.AI', authorList: '' },
      mockHttp,
      new Date('2025-06-16'),
      sleepFn
    )
    expect(sleepFn).toHaveBeenCalledTimes(2)
    expect(sleepFn.mock.calls[1][0]).toBeGreaterThan(sleepFn.mock.calls[0][0])
  })
})