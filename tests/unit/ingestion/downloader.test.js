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
    const result = await downloadPdf('2401.00001', 'https://arxiv.org/pdf/2401.00001', mockHttp, tmpDir)

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
      downloadPdf('2401.00001', 'https://arxiv.org/pdf/2401.00001', mockHttp, tmpDir)
    ).resolves.toMatchObject({ success: false })
  })

  it('does not create a file when download fails', async () => {
    const mockHttp = { get: vi.fn().mockRejectedValue(new Error('boom')) }
    await downloadPdf('2401.00001', 'https://arxiv.org/pdf/2401.00001', mockHttp, tmpDir)

    expect(fs.existsSync(path.join(tmpDir, '2401.00001.pdf'))).toBe(false)
  })
})