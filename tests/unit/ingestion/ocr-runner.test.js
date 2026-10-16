import { describe, it, expect, vi } from 'vitest'
import { resolveOcrEngine, runOcrOnBuffer } from '../../../src/ingestion/ocr-runner.js'

const PAPER = { id: '2401.00001', title: 'T', pdf_text: 'texto básico', pdf_text_source: 'pdf-parse', ocr_error: null }
const BUFFER = Buffer.from('%PDF-1.4 fake')

describe('resolveOcrEngine', () => {
  it('LlamaParse without a key reports it and builds no LLM', () => {
    const createLLM = vi.fn()

    const engine = resolveOcrEngine({ ocrEngine: 'llamaparse' }, createLLM)

    expect(engine).toEqual({ error: 'no-llamaparse-key' })
    expect(createLLM).not.toHaveBeenCalled()
  })

  it('LlamaParse with a key needs no LLM at all (works with providers without vision)', () => {
    const createLLM = vi.fn()

    const engine = resolveOcrEngine({ ocrEngine: 'llamaparse', llamaParseApiKey: 'llx-1', llamaParseTier: 'agentic' }, createLLM)

    expect(engine).toMatchObject({ useLlamaParse: true, llm: null })
    expect(engine.ocr.llamaParse).toEqual({ apiKey: 'llx-1', tier: 'agentic' })
    expect(createLLM).not.toHaveBeenCalled()
  })

  it('vision engine builds the LLM with the OCR model override', () => {
    const llm = { transcribePageToMarkdown: vi.fn() }
    const createLLM = vi.fn().mockReturnValue(llm)

    const engine = resolveOcrEngine({ ocrEngine: 'vision', llmModel: 'gpt-4o-mini', ocrModel: 'gpt-4o' }, createLLM)

    expect(engine).toMatchObject({ useLlamaParse: false, llm })
    expect(createLLM.mock.calls[0][0].llmModel).toBe('gpt-4o')
  })

  it('vision engine with a provider that cannot read images reports no-vision', () => {
    const createLLM = vi.fn().mockReturnValue({ chat: vi.fn() })

    expect(resolveOcrEngine({ ocrEngine: 'vision' }, createLLM)).toEqual({ error: 'no-vision' })
  })
})

describe('runOcrOnBuffer', () => {
  function makeDeps(overrides = {}) {
    return {
      vault: { writeOcr: vi.fn() },
      httpClient: {},
      OCR_MAX_CHARS: 200000,
      rasterizePdf: vi.fn(), pdfParse: vi.fn(), extractPagesText: vi.fn(),
      parsePdfWithLlamaParse: vi.fn().mockResolvedValue({ success: true, markdown: '# OCR', pageCount: 3 }),
      transcribePdfToMarkdown: vi.fn().mockResolvedValue({ success: true, markdown: '# vision', pageCount: 2, fallbackUsed: false }),
      ...overrides,
    }
  }
  const llamaEngine = { useLlamaParse: true, llm: null, ocr: { llamaParse: { apiKey: 'llx-1', tier: 'cost_effective' } } }
  const visionEngine = { useLlamaParse: false, llm: { transcribePageToMarkdown: vi.fn() }, ocr: {} }

  it('with LlamaParse: persists the markdown as the paper text and returns the updated paper', async () => {
    const db = { savePaper: vi.fn() }
    const deps = makeDeps()

    const result = await runOcrOnBuffer({ paper: PAPER, buffer: BUFFER, engine: llamaEngine, db, deps })

    expect(deps.parsePdfWithLlamaParse).toHaveBeenCalledWith(BUFFER, { apiKey: 'llx-1', tier: 'cost_effective', httpClient: deps.httpClient })
    expect(deps.vault.writeOcr).toHaveBeenCalledWith(PAPER, '# OCR')
    expect(db.savePaper).toHaveBeenCalledWith({ ...PAPER, pdf_text: '# OCR', pdf_text_source: 'ocr', ocr_error: null })
    expect(result).toMatchObject({ success: true, pageCount: 3, fallbackUsed: false })
    expect(result.paper).toMatchObject({ pdf_text: '# OCR', pdf_text_source: 'ocr' })
  })

  it('with the vision model: runs the page-by-page transcription and forwards progress', async () => {
    const db = { savePaper: vi.fn() }
    const deps = makeDeps()
    const onProgress = vi.fn()
    deps.transcribePdfToMarkdown.mockImplementation(async (_buf, opts) => {
      opts.onProgress(1, 2)
      return { success: true, markdown: '# vision', pageCount: 2, fallbackUsed: false }
    })

    await runOcrOnBuffer({ paper: PAPER, buffer: BUFFER, engine: visionEngine, db, deps, onProgress })

    expect(deps.parsePdfWithLlamaParse).not.toHaveBeenCalled()
    expect(onProgress).toHaveBeenCalledWith(1, 2)
  })

  it('on failure keeps the existing text, records ocr_error and never falls back to the paid vision OCR', async () => {
    const db = { savePaper: vi.fn() }
    const deps = makeDeps({ parsePdfWithLlamaParse: vi.fn().mockResolvedValue({ success: false, error: 'LlamaParse: sin créditos' }) })

    const result = await runOcrOnBuffer({ paper: PAPER, buffer: BUFFER, engine: llamaEngine, db, deps })

    expect(result).toEqual({ success: false, error: 'LlamaParse: sin créditos' })
    expect(db.savePaper).toHaveBeenCalledWith({ ...PAPER, ocr_error: 'LlamaParse: sin créditos' })
    expect(deps.transcribePdfToMarkdown).not.toHaveBeenCalled()
    expect(deps.vault.writeOcr).not.toHaveBeenCalled()
  })

  it('turns a thrown error into a failure instead of rejecting', async () => {
    const db = { savePaper: vi.fn() }
    const deps = makeDeps({ parsePdfWithLlamaParse: vi.fn().mockRejectedValue(new Error('boom')) })

    await expect(runOcrOnBuffer({ paper: PAPER, buffer: BUFFER, engine: llamaEngine, db, deps }))
      .resolves.toEqual({ success: false, error: 'boom' })
  })

  it('flags pages that fell back to pdf-parse', async () => {
    const db = { savePaper: vi.fn() }
    const deps = makeDeps({ transcribePdfToMarkdown: vi.fn().mockResolvedValue({ success: true, markdown: 'md', pageCount: 2, fallbackUsed: true }) })

    const result = await runOcrOnBuffer({ paper: PAPER, buffer: BUFFER, engine: visionEngine, db, deps })

    expect(result.fallbackUsed).toBe(true)
    expect(db.savePaper.mock.calls[0][0].ocr_error).toMatch(/fallback/)
  })

  it('caps the stored text at OCR_MAX_CHARS', async () => {
    const db = { savePaper: vi.fn() }
    const deps = makeDeps({ OCR_MAX_CHARS: 10, parsePdfWithLlamaParse: vi.fn().mockResolvedValue({ success: true, markdown: 'x'.repeat(50), pageCount: 1 }) })

    await runOcrOnBuffer({ paper: PAPER, buffer: BUFFER, engine: llamaEngine, db, deps })

    expect(db.savePaper.mock.calls[0][0].pdf_text).toHaveLength(10)
  })

  it('a failing vault write does not lose the OCR text', async () => {
    const db = { savePaper: vi.fn() }
    const deps = makeDeps()
    deps.vault.writeOcr.mockImplementation(() => { throw new Error('disk full') })

    const result = await runOcrOnBuffer({ paper: PAPER, buffer: BUFFER, engine: llamaEngine, db, deps })

    expect(result.success).toBe(true)
    expect(db.savePaper).toHaveBeenCalledWith(expect.objectContaining({ pdf_text: '# OCR' }))
  })
})
