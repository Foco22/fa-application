import { describe, it, expect, vi } from 'vitest'
import { extractText } from '../../../src/ingestion/extractor.js'

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