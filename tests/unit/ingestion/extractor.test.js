import { describe, it, expect, vi } from 'vitest'
import { extractText, extractPagesText, OCR_MAX_CHARS } from '../../../src/ingestion/extractor.js'

// Simulate pdf-parse invoking options.pagerender once per page, in order.
function makePagedPdfParse(pageTexts) {
  return vi.fn(async (_buf, options) => {
    let combined = ''
    for (let i = 0; i < pageTexts.length; i++) {
      const pageData = {
        pageNumber: i + 1,
        getTextContent: async () => ({ items: pageTexts[i].split(' ').map(str => ({ str })) }),
      }
      combined += await options.pagerender(pageData)
    }
    return { text: combined, numpages: pageTexts.length }
  })
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeMockPdfParse(text) {
  return vi.fn().mockResolvedValue({ text })
}

// ─── extractText ──────────────────────────────────────────────────────────────

describe('extractText', () => {
  it('returns extracted text from a valid PDF buffer', async () => {
    const mockParse = makeMockPdfParse('Hello world from the paper.')
    const buf = Buffer.from('%PDF fake')
    const result = await extractText(buf, mockParse)

    expect(result.success).toBe(true)
    expect(result.text).toBe('Hello world from the paper.')
  })

  it('truncates text to 30000 characters', async () => {
    const longText = 'a'.repeat(50000)
    const mockParse = makeMockPdfParse(longText)
    const result = await extractText(Buffer.from('%PDF fake'), mockParse)

    expect(result.success).toBe(true)
    expect(result.text.length).toBe(30000)
  })

  it('does not truncate text shorter than 30000 characters', async () => {
    const shortText = 'Short paper.'
    const mockParse = makeMockPdfParse(shortText)
    const result = await extractText(Buffer.from('%PDF fake'), mockParse)

    expect(result.text.length).toBe(shortText.length)
  })

  it('returns { success: false, error } when pdf-parse throws', async () => {
    const mockParse = vi.fn().mockRejectedValue(new Error('invalid PDF structure'))
    const result = await extractText(Buffer.from('not a pdf'), mockParse)

    expect(result.success).toBe(false)
    expect(result.error).toContain('invalid PDF structure')
  })

  it('never throws — always returns an object', async () => {
    const mockParse = vi.fn().mockRejectedValue(new Error('boom'))
    await expect(
      extractText(Buffer.from('bad'), mockParse)
    ).resolves.toMatchObject({ success: false })
  })

  it('returns { success: false, error } when extracted text is empty', async () => {
    const mockParse = makeMockPdfParse('   ')
    const result = await extractText(Buffer.from('%PDF fake'), mockParse)

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('passes the buffer directly to the parser', async () => {
    const mockParse = makeMockPdfParse('text')
    const buf = Buffer.from('%PDF real buffer')
    await extractText(buf, mockParse)

    expect(mockParse).toHaveBeenCalledWith(buf)
  })
})

// ─── extractPagesText (per-page fallback for OCR) ─────────────────────────────

describe('extractPagesText', () => {
  it('returns one text entry per page, in order', async () => {
    const parse = makePagedPdfParse(['page one text', 'page two text', 'page three'])
    const result = await extractPagesText(Buffer.from('%PDF'), parse)
    expect(result.success).toBe(true)
    expect(result.pages).toEqual(['page one text', 'page two text', 'page three'])
  })

  it('returns { success: false, error } when pdf-parse throws', async () => {
    const parse = vi.fn().mockRejectedValue(new Error('corrupt'))
    const result = await extractPagesText(Buffer.from('bad'), parse)
    expect(result.success).toBe(false)
    expect(result.error).toContain('corrupt')
  })

  it('never throws', async () => {
    const parse = vi.fn().mockRejectedValue(new Error('boom'))
    await expect(extractPagesText(Buffer.from('bad'), parse)).resolves.toMatchObject({ success: false })
  })
})

// ─── OCR_MAX_CHARS ────────────────────────────────────────────────────────────

describe('OCR_MAX_CHARS', () => {
  it('is a much higher ceiling than the 30000 pdf-parse truncation', () => {
    expect(OCR_MAX_CHARS).toBeGreaterThanOrEqual(200000)
  })
})