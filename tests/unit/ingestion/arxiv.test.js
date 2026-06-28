import { describe, it, expect, vi } from 'vitest'
import { calculateDateWindow, buildQuery, parseFeed, fetchPapers } from '../../../src/ingestion/arxiv.js'

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

describe('calculateDateWindow', () => {
  it('returns last Mon→Sun when today is Monday', () => {
    // Monday 2025-06-16
    const { from, to } = calculateDateWindow(new Date('2025-06-16'))
    expect(from).toBe('20250609')
    expect(to).toBe('20250615')
  })

  it('returns last Mon→Sun when today is Wednesday (mid-week)', () => {
    // Wednesday 2025-06-18
    const { from, to } = calculateDateWindow(new Date('2025-06-18'))
    expect(from).toBe('20250609')
    expect(to).toBe('20250615')
  })

  it('returns last Mon→Sun when today is Sunday', () => {
    // Sunday 2025-06-22
    const { from, to } = calculateDateWindow(new Date('2025-06-22'))
    expect(from).toBe('20250609')
    expect(to).toBe('20250615')
  })

  it('returns last Mon→Sun when today is Saturday', () => {
    // Saturday 2025-06-21
    const { from, to } = calculateDateWindow(new Date('2025-06-21'))
    expect(from).toBe('20250609')
    expect(to).toBe('20250615')
  })

  it('output strings are exactly 8 digits (YYYYMMDD)', () => {
    const { from, to } = calculateDateWindow(new Date('2025-06-16'))
    expect(from).toMatch(/^\d{8}$/)
    expect(to).toMatch(/^\d{8}$/)
  })

  it('from is always 6 days before to', () => {
    const { from, to } = calculateDateWindow(new Date('2025-06-16'))
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

describe('fetchPapers', () => {
  it('returns { error } when both lists are empty', async () => {
    const result = await fetchPapers(
      { categoryList: '', authorList: '', maxPapers: '3' },
      null, // httpClient not needed
      new Date('2025-06-16')
    )
    expect(result.error).toBeDefined()
  })

  it('calls the ArXiv API with the correct base URL', async () => {
    const mockHttp = { get: vi.fn().mockResolvedValue({ data: FEED_ONE }) }
    await fetchPapers(
      { categoryList: 'cs.AI', authorList: '', maxPapers: '3' },
      mockHttp,
      new Date('2025-06-16')
    )
    expect(mockHttp.get).toHaveBeenCalledOnce()
    const url = mockHttp.get.mock.calls[0][0]
    expect(url).toContain('export.arxiv.org/api/query')
  })

  it('passes max_results from settings to the API', async () => {
    const mockHttp = { get: vi.fn().mockResolvedValue({ data: FEED_ONE }) }
    await fetchPapers(
      { categoryList: 'cs.AI', authorList: '', maxPapers: '5' },
      mockHttp,
      new Date('2025-06-16')
    )
    const url = mockHttp.get.mock.calls[0][0]
    expect(url).toContain('max_results=5')
  })

  it('returns parsed papers on success', async () => {
    const mockHttp = { get: vi.fn().mockResolvedValue({ data: FEED_TWO }) }
    const papers = await fetchPapers(
      { categoryList: 'cs.AI', authorList: '', maxPapers: '3' },
      mockHttp,
      new Date('2025-06-16')
    )
    expect(Array.isArray(papers)).toBe(true)
    expect(papers).toHaveLength(2)
  })

  it('returns { error } when the HTTP call throws', async () => {
    const mockHttp = { get: vi.fn().mockRejectedValue(new Error('network error')) }
    const result = await fetchPapers(
      { categoryList: 'cs.AI', authorList: '', maxPapers: '3' },
      mockHttp,
      new Date('2025-06-16')
    )
    expect(result.error).toContain('network error')
  })
})