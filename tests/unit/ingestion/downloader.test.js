import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { downloadPdf } from '../../../src/ingestion/downloader.js'
import fs from 'fs'
import path from 'path'
import os from 'os'

let tmpDir

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-dl-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

const fakePdf = Buffer.from('%PDF-1.4 fake content')

// ─── success path ─────────────────────────────────────────────────────────────

describe('downloadPdf — success', () => {
  it('returns { success: true, path } on successful download', async () => {
    const mockHttp = { get: vi.fn().mockResolvedValue({ data: fakePdf }) }
    const result = await downloadPdf('2401.00001', 'https://arxiv.org/pdf/2401.00001', mockHttp, tmpDir)

    expect(result.success).toBe(true)
    expect(result.path).toBeDefined()
  })

  it('writes the file to destDir/{arxivId}.pdf', async () => {
    const mockHttp = { get: vi.fn().mockResolvedValue({ data: fakePdf }) }
    const result = await downloadPdf('2401.00001', 'https://arxiv.org/pdf/2401.00001', mockHttp, tmpDir)

    const expectedPath = path.join(tmpDir, '2401.00001.pdf')
    expect(result.path).toBe(expectedPath)
    expect(fs.existsSync(expectedPath)).toBe(true)
  })

  it('writes the received bytes to disk', async () => {
    const mockHttp = { get: vi.fn().mockResolvedValue({ data: fakePdf }) }
    await downloadPdf('2401.00001', 'https://arxiv.org/pdf/2401.00001', mockHttp, tmpDir)

    const written = fs.readFileSync(path.join(tmpDir, '2401.00001.pdf'))
    expect(written).toEqual(fakePdf)
  })

  it('calls the HTTP client with responseType arraybuffer', async () => {
    const mockHttp = { get: vi.fn().mockResolvedValue({ data: fakePdf }) }
    await downloadPdf('2401.00001', 'https://arxiv.org/pdf/2401.00001', mockHttp, tmpDir)

    const config = mockHttp.get.mock.calls[0][1]
    expect(config.responseType).toBe('arraybuffer')
  })

  it('calls the HTTP client with the given pdf URL', async () => {
    const mockHttp = { get: vi.fn().mockResolvedValue({ data: fakePdf }) }
    await downloadPdf('2401.00001', 'https://arxiv.org/pdf/2401.00001', mockHttp, tmpDir)

    expect(mockHttp.get.mock.calls[0][0]).toBe('https://arxiv.org/pdf/2401.00001')
  })
})

// ─── error path ───────────────────────────────────────────────────────────────

describe('downloadPdf — errors', () => {
  it('returns { success: false, error } when HTTP throws', async () => {
    const mockHttp = { get: vi.fn().mockRejectedValue(new Error('connection refused')) }
    const result = await downloadPdf('2401.00001', 'https://arxiv.org/pdf/2401.00001', mockHttp, tmpDir, { sleepFn: () => Promise.resolve() })

    expect(result.success).toBe(false)
    expect(result.error).toContain('connection refused')
  })

  it('returns { success: false, error } on 403 response', async () => {
    const err = Object.assign(new Error('Request failed with status code 403'), { response: { status: 403 } })
    const mockHttp = { get: vi.fn().mockRejectedValue(err) }
    const result = await downloadPdf('2401.00001', 'https://arxiv.org/pdf/2401.00001', mockHttp, tmpDir)

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('never throws — always returns an object', async () => {
    const mockHttp = { get: vi.fn().mockRejectedValue(new Error('boom')) }

    await expect(
      downloadPdf('2401.00001', 'https://arxiv.org/pdf/2401.00001', mockHttp, tmpDir, { sleepFn: () => Promise.resolve() })
    ).resolves.toMatchObject({ success: false })
  })

  it('does not create a file when download fails', async () => {
    const mockHttp = { get: vi.fn().mockRejectedValue(new Error('boom')) }
    await downloadPdf('2401.00001', 'https://arxiv.org/pdf/2401.00001', mockHttp, tmpDir, { sleepFn: () => Promise.resolve() })

    expect(fs.existsSync(path.join(tmpDir, '2401.00001.pdf'))).toBe(false)
  })
})

// ─── timeout, retries and content check ───────────────────────────────────────
// ArXiv rate-limits and flakes: a single timeout used to cost the user a paper
// (the download had no timeout and no retry).

describe('downloadPdf — timeout and retries', () => {
  const URL = 'https://arxiv.org/pdf/2401.00001'
  const noSleep = () => Promise.resolve()
  const status = (code) => Object.assign(new Error(`Request failed with status code ${code}`), { response: { status: code } })

  it('passes a timeout to the HTTP client so a stalled download cannot hang the fetch', async () => {
    const mockHttp = { get: vi.fn().mockResolvedValue({ data: fakePdf }) }
    await downloadPdf('2401.00001', URL, mockHttp, tmpDir)

    expect(mockHttp.get.mock.calls[0][1].timeout).toBeGreaterThan(0)
  })

  it('retries a network error and succeeds on a later attempt', async () => {
    const mockHttp = { get: vi.fn()
      .mockRejectedValueOnce(new Error('timeout of 30000ms exceeded'))
      .mockResolvedValue({ data: fakePdf }) }

    const result = await downloadPdf('2401.00001', URL, mockHttp, tmpDir, { sleepFn: noSleep })

    expect(result.success).toBe(true)
    expect(mockHttp.get).toHaveBeenCalledTimes(2)
    expect(fs.readFileSync(path.join(tmpDir, '2401.00001.pdf'))).toEqual(fakePdf)
  })

  it.each([429, 500, 503])('retries on HTTP %i', async (code) => {
    const mockHttp = { get: vi.fn().mockRejectedValueOnce(status(code)).mockResolvedValue({ data: fakePdf }) }

    const result = await downloadPdf('2401.00001', URL, mockHttp, tmpDir, { sleepFn: noSleep })

    expect(result.success).toBe(true)
    expect(mockHttp.get).toHaveBeenCalledTimes(2)
  })

  it.each([403, 404])('does not retry on HTTP %i — the request itself is wrong', async (code) => {
    const mockHttp = { get: vi.fn().mockRejectedValue(status(code)) }

    const result = await downloadPdf('2401.00001', URL, mockHttp, tmpDir, { sleepFn: noSleep })

    expect(result.success).toBe(false)
    expect(mockHttp.get).toHaveBeenCalledTimes(1)
  })

  it('gives up after the max attempts and reports how many it made, without throwing', async () => {
    const mockHttp = { get: vi.fn().mockRejectedValue(new Error('ECONNRESET')) }

    const result = await downloadPdf('2401.00001', URL, mockHttp, tmpDir, { sleepFn: noSleep })

    expect(result.success).toBe(false)
    expect(result.error).toContain('ECONNRESET')
    expect(result.error).toContain('3')
    expect(mockHttp.get).toHaveBeenCalledTimes(3)
    expect(fs.existsSync(path.join(tmpDir, '2401.00001.pdf'))).toBe(false)
  })

  it('waits longer between each retry (linear backoff)', async () => {
    const sleepFn = vi.fn().mockResolvedValue()
    const mockHttp = { get: vi.fn().mockRejectedValue(new Error('boom')) }

    await downloadPdf('2401.00001', URL, mockHttp, tmpDir, { sleepFn, baseDelayMs: 1000 })

    expect(sleepFn.mock.calls.map(c => c[0])).toEqual([1000, 2000])
  })

  it('treats a 200 response that is not a PDF (e.g. an HTML rate-limit page) as a retryable failure', async () => {
    const html = Buffer.from('<html>Too many requests</html>')
    const mockHttp = { get: vi.fn()
      .mockResolvedValueOnce({ data: html })
      .mockResolvedValue({ data: fakePdf }) }

    const result = await downloadPdf('2401.00001', URL, mockHttp, tmpDir, { sleepFn: noSleep })

    expect(result.success).toBe(true)
    expect(mockHttp.get).toHaveBeenCalledTimes(2)
    expect(fs.readFileSync(path.join(tmpDir, '2401.00001.pdf'))).toEqual(fakePdf)
  })

  it('never writes a non-PDF body to disk', async () => {
    const mockHttp = { get: vi.fn().mockResolvedValue({ data: Buffer.from('<html>blocked</html>') }) }

    const result = await downloadPdf('2401.00001', URL, mockHttp, tmpDir, { sleepFn: noSleep })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/PDF/)
    expect(fs.existsSync(path.join(tmpDir, '2401.00001.pdf'))).toBe(false)
  })
})