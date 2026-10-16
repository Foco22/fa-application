import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import os from 'os'
import fs from 'fs'
import path from 'path'
import { registerLearningHandlers } from '../../../src/ipc/learning.js'

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeIpcMain() {
  const handlers = {}
  return {
    ipcMain:  { handle: (ch, fn) => { handlers[ch] = fn } },
    invoke:   (ch, ...args) => handlers[ch]({}, ...args),
    handlers,
  }
}

const EVENT = {}

const PAPER = {
  id: '2401.00001', title: 'Test Paper', authors: 'Alice',
  abstract: 'Abstract.', pdf_text: 'Full text.', pdf_text_source: 'ocr',
  summary: null, quiz: null,
}

const SETTINGS = { apiKey: 'sk-test' }

// ─── chat-message ─────────────────────────────────────────────────────────────

// OCR obligatorio: resumen, quiz y chat con el paper solo corren sobre el texto del
// OCR. El backend lo impone aunque la interfaz falle en avisar.
describe('OCR obligatorio (learning handlers)', () => {
  const BASIC = { ...PAPER, pdf_text_source: 'pdf-parse' }

  function setup(paper) {
    const { ipcMain, invoke } = makeIpcMain()
    const mainWindow = { webContents: { send: vi.fn() } }
    const db = {
      getAllSettings: vi.fn().mockReturnValue(SETTINGS),
      getPaper:      vi.fn().mockReturnValue(paper),
      savePaper:     vi.fn(),
    }
    const llm  = { generateQuiz: vi.fn(), streamSummary: vi.fn() }
    const deps = {
      createLLM:     vi.fn().mockReturnValue(llm),
      chatWithPaper: vi.fn().mockResolvedValue('respuesta'),
      vault:         { writeQuiz: vi.fn(), writeSummary: vi.fn() },
    }
    registerLearningHandlers({ ipcMain, db, deps, mainWindow })
    return { invoke, db, deps, llm, mainWindow }
  }

  it('generate-quiz refuses a paper without OCR and spends no tokens', async () => {
    const { invoke, db, deps, llm } = setup(BASIC)

    const result = await invoke('generate-quiz', '2401.00001')

    expect(result).toEqual({ error: 'ocr-required' })
    expect(llm.generateQuiz).not.toHaveBeenCalled()
    expect(deps.createLLM).not.toHaveBeenCalled()
    expect(db.savePaper).not.toHaveBeenCalled()
  })

  it('start-summary refuses a paper without OCR and spends no tokens', async () => {
    const { invoke, db, llm, mainWindow } = setup(BASIC)

    const result = await invoke('start-summary', '2401.00001')

    expect(result).toEqual({ error: 'ocr-required' })
    expect(llm.streamSummary).not.toHaveBeenCalled()
    expect(db.savePaper).not.toHaveBeenCalled()
    expect(mainWindow.webContents.send).not.toHaveBeenCalled()
  })

  it('chat-message about a paper without OCR is refused', async () => {
    const { invoke, deps } = setup(BASIC)

    const result = await invoke('chat-message', { message: 'hola', paperId: '2401.00001', history: [] })

    expect(result).toEqual({ error: 'ocr-required' })
    expect(deps.chatWithPaper).not.toHaveBeenCalled()
  })

  it('chat-message without a paper (general research questions) is NOT gated', async () => {
    const { invoke, deps } = setup(null)

    const result = await invoke('chat-message', { message: 'hola', paperId: null, history: [] })

    expect(result).toBe('respuesta')
    expect(deps.chatWithPaper).toHaveBeenCalledOnce()
  })

  it('treats a paper saved before the OCR feature (null source) as not having OCR', async () => {
    const { invoke } = setup({ ...PAPER, pdf_text_source: null })

    expect(await invoke('generate-quiz', '2401.00001')).toEqual({ error: 'ocr-required' })
  })

  it('runs normally once the paper has OCR', async () => {
    const { invoke, llm } = setup(PAPER)
    llm.generateQuiz.mockResolvedValue({ questions: [] })

    const result = await invoke('generate-quiz', '2401.00001')

    expect(result).toEqual({ questions: [] })
  })
})

describe('chat-message', () => {
  it('creates LLM from settings and calls chatWithPaper', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const mockChat = vi.fn().mockResolvedValue('La respuesta es...')
    const mockLLM  = { chat: mockChat }
    const db = {
      getAllSettings: vi.fn().mockReturnValue(SETTINGS),
      getPaper:      vi.fn().mockReturnValue(PAPER),
    }
    const deps = {
      createLLM:    vi.fn().mockReturnValue(mockLLM),
      chatWithPaper: vi.fn().mockResolvedValue('La respuesta es...'),
      vault:        {},
    }
    registerLearningHandlers({ ipcMain, db, deps, mainWindow: null })

    const result = await invoke('chat-message', { message: 'Explica el método', paperId: '2401.00001', history: [] })

    expect(deps.createLLM).toHaveBeenCalledWith(SETTINGS)
    // El idioma activo viaja al chat: las respuestas salen en el mismo idioma que
    // el resto de la app, no mezclado.
    expect(deps.chatWithPaper).toHaveBeenCalledWith('Explica el método', PAPER, [], mockLLM, undefined)
    expect(result).toBe('La respuesta es...')
  })

  it('passes null paper when no paperId is provided', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const db = {
      getAllSettings: vi.fn().mockReturnValue(SETTINGS),
      getPaper:      vi.fn(),
    }
    const deps = {
      createLLM:    vi.fn().mockReturnValue({}),
      chatWithPaper: vi.fn().mockResolvedValue('respuesta'),
      vault:        {},
    }
    registerLearningHandlers({ ipcMain, db, deps, mainWindow: null })

    await invoke('chat-message', { message: 'hola', paperId: null, history: [] })

    expect(deps.chatWithPaper).toHaveBeenCalledWith('hola', null, [], expect.anything(), undefined)
  })

  it('defaults history to [] when not provided', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const db = {
      getAllSettings: vi.fn().mockReturnValue(SETTINGS),
      getPaper:      vi.fn().mockReturnValue(null),
    }
    const deps = {
      createLLM:    vi.fn().mockReturnValue({}),
      chatWithPaper: vi.fn().mockResolvedValue('ok'),
      vault:        {},
    }
    registerLearningHandlers({ ipcMain, db, deps, mainWindow: null })

    await invoke('chat-message', { message: 'hola', paperId: null })

    expect(deps.chatWithPaper).toHaveBeenCalledWith('hola', null, [], expect.anything(), undefined)
  })

  // El idioma sale del setting guardado, no de un valor del renderer: el chat
  // responde en el mismo idioma que el resto de la app.
  it('passes the saved language through to chatWithPaper', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const db = {
      getAllSettings: vi.fn().mockReturnValue({ ...SETTINGS, language: 'en' }),
      getPaper:      vi.fn().mockReturnValue(null),
    }
    const deps = {
      createLLM:     vi.fn().mockReturnValue({}),
      chatWithPaper: vi.fn().mockResolvedValue('ok'),
      vault:         {},
    }
    registerLearningHandlers({ ipcMain, db, deps, mainWindow: null })

    await invoke('chat-message', { message: 'hi', paperId: null })

    expect(deps.chatWithPaper).toHaveBeenCalledWith('hi', null, [], expect.anything(), 'en')
  })
})

// ─── generate-quiz ────────────────────────────────────────────────────────────

describe('generate-quiz (learning handler)', () => {
  it('persists quiz and writes to vault', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const quiz = { questions: [] }
    const db = {
      getAllSettings: vi.fn().mockReturnValue(SETTINGS),
      getPaper:      vi.fn().mockReturnValue(PAPER),
      savePaper:     vi.fn(),
    }
    const deps = {
      createLLM: vi.fn().mockReturnValue({ generateQuiz: vi.fn().mockResolvedValue(quiz) }),
      vault:     { writeQuiz: vi.fn() },
    }
    registerLearningHandlers({ ipcMain, db, deps, mainWindow: null })

    await invoke('generate-quiz', '2401.00001')

    expect(db.savePaper).toHaveBeenCalledWith(expect.objectContaining({ quiz: JSON.stringify(quiz) }))
    expect(deps.vault.writeQuiz).toHaveBeenCalledWith(PAPER, quiz)
  })

  it('does not throw if vault.writeQuiz fails', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const db = {
      getAllSettings: vi.fn().mockReturnValue(SETTINGS),
      getPaper:      vi.fn().mockReturnValue(PAPER),
      savePaper:     vi.fn(),
    }
    const deps = {
      createLLM: vi.fn().mockReturnValue({ generateQuiz: vi.fn().mockResolvedValue({}) }),
      vault:     { writeQuiz: vi.fn().mockImplementation(() => { throw new Error('disk full') }) },
    }
    registerLearningHandlers({ ipcMain, db, deps, mainWindow: null })

    await expect(invoke('generate-quiz', '2401.00001')).resolves.not.toThrow()
  })
})

// ─── start-summary ────────────────────────────────────────────────────────────

describe('start-summary (learning handler)', () => {
  it('does not throw if vault.writeSummary fails', async () => {
    const { ipcMain, handlers } = makeIpcMain()
    const mockWindow = { webContents: { send: vi.fn() } }
    const db = {
      getAllSettings: vi.fn().mockReturnValue(SETTINGS),
      getPaper:      vi.fn().mockReturnValue(PAPER),
      savePaper:     vi.fn(),
    }
    const deps = {
      createLLM: vi.fn().mockReturnValue({ streamSummary: vi.fn().mockResolvedValue('text') }),
      vault:     { writeSummary: vi.fn().mockImplementation(() => { throw new Error('disk full') }) },
    }
    registerLearningHandlers({ ipcMain, db, deps, mainWindow: mockWindow })

    await expect(handlers['start-summary'](EVENT, '2401.00001')).resolves.not.toThrow()
    expect(mockWindow.webContents.send).toHaveBeenCalledWith('summary-done')
  })
})

// ─── generate-ocr con LlamaParse ───────────────────────────────────────────────
// Si hay llamaParseApiKey, el OCR lo hace LlamaParse (gratis hasta 10k créditos/mes)
// en vez del modelo de visión del LLM activo: no gasta tokens del LLM y funciona
// también con proveedores sin visión (DeepSeek).

describe('generate-ocr con LlamaParse (learning handler)', () => {
  let tmpDir, pdfFile
  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-llx-'))
    pdfFile = path.join(tmpDir, 'raw.pdf')
    fs.writeFileSync(pdfFile, '%PDF-1.4 fake')
  })
  afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }))

  const LLX_SETTINGS = { apiKey: 'sk-test', llamaParseApiKey: 'llx-test-key-0000' }

  function llxDeps(overrides = {}) {
    return {
      createLLM: vi.fn().mockReturnValue({ chat: vi.fn() }), // sin visión, a propósito
      vault: { pdfPath: vi.fn().mockReturnValue(pdfFile), writeOcr: vi.fn(), readOcr: vi.fn() },
      httpClient: {},
      OCR_MAX_CHARS: 200000,
      transcribePdfToMarkdown: vi.fn(),
      parsePdfWithLlamaParse: vi.fn().mockResolvedValue({ success: true, markdown: '# From LlamaParse', pageCount: 4 }),
      ...overrides,
    }
  }

  function makeDb(settings = LLX_SETTINGS) {
    return {
      getAllSettings: vi.fn().mockReturnValue(settings),
      getPaper: vi.fn().mockReturnValue({ ...PAPER, pdf_text_source: 'pdf-parse' }),
      savePaper: vi.fn(),
    }
  }

  it('uses LlamaParse instead of the vision LLM and persists the markdown as OCR text', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const db = makeDb()
    const deps = llxDeps()
    registerLearningHandlers({ ipcMain, db, deps, mainWindow: null })

    const result = await invoke('generate-ocr', { paperId: '2401.00001' })

    expect(result).toMatchObject({ success: true, pageCount: 4, fallbackUsed: false })
    expect(deps.transcribePdfToMarkdown).not.toHaveBeenCalled()
    expect(deps.parsePdfWithLlamaParse.mock.calls[0][1]).toMatchObject({ apiKey: 'llx-test-key-0000', httpClient: deps.httpClient })
    expect(deps.vault.writeOcr).toHaveBeenCalledWith(expect.objectContaining({ id: '2401.00001' }), '# From LlamaParse')
    expect(db.savePaper).toHaveBeenCalledWith(expect.objectContaining({
      pdf_text: '# From LlamaParse', pdf_text_source: 'ocr', ocr_error: null,
    }))
  })

  it('works even when the active LLM has no vision (the old path answered no-vision)', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    registerLearningHandlers({ ipcMain, db: makeDb(), deps: llxDeps(), mainWindow: null })

    const result = await invoke('generate-ocr', { paperId: '2401.00001' })

    expect(result.success).toBe(true)
  })

  it('on failure records ocr_error, notifies the renderer and does NOT silently fall back to the paid vision OCR', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const db = makeDb()
    const mainWindow = { webContents: { send: vi.fn() } }
    const deps = llxDeps({
      createLLM: vi.fn().mockReturnValue({ transcribePageToMarkdown: vi.fn() }),
      parsePdfWithLlamaParse: vi.fn().mockResolvedValue({ success: false, error: 'LlamaParse: sin créditos' }),
    })
    registerLearningHandlers({ ipcMain, db, deps, mainWindow })

    const result = await invoke('generate-ocr', { paperId: '2401.00001' })

    expect(result).toEqual({ success: false, error: 'LlamaParse: sin créditos' })
    expect(deps.transcribePdfToMarkdown).not.toHaveBeenCalled()
    expect(db.savePaper).toHaveBeenCalledWith(expect.objectContaining({ ocr_error: 'LlamaParse: sin créditos' }))
    expect(db.savePaper.mock.calls[0][0].pdf_text).toBe(PAPER.pdf_text) // el texto existente no se toca
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('ocr-error', { paperId: '2401.00001', error: 'LlamaParse: sin créditos' })
  })

  it('passes the chosen LlamaParse tier to the client', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const deps = llxDeps()
    registerLearningHandlers({ ipcMain, db: makeDb({ ...LLX_SETTINGS, ocrEngine: 'llamaparse', llamaParseTier: 'agentic' }), deps, mainWindow: null })

    await invoke('generate-ocr', { paperId: '2401.00001' })

    expect(deps.parsePdfWithLlamaParse.mock.calls[0][1].tier).toBe('agentic')
  })

  it('engine "llamaparse" without a key asks for it instead of silently using the paid vision OCR', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const deps = llxDeps()
    registerLearningHandlers({ ipcMain, db: makeDb({ apiKey: 'sk-test', ocrEngine: 'llamaparse' }), deps, mainWindow: null })

    const result = await invoke('generate-ocr', { paperId: '2401.00001' })

    expect(result).toEqual({ success: false, error: 'no-llamaparse-key' })
    expect(deps.parsePdfWithLlamaParse).not.toHaveBeenCalled()
    expect(deps.transcribePdfToMarkdown).not.toHaveBeenCalled()
  })

  it('engine "vision" ignores a stored LlamaParse key and OCRs with the vision model picked for OCR', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const createLLM = vi.fn().mockReturnValue({ transcribePageToMarkdown: vi.fn() })
    const deps = llxDeps({
      createLLM,
      transcribePdfToMarkdown: vi.fn().mockResolvedValue({ success: true, markdown: 'vision', pageCount: 1, fallbackUsed: false }),
      rasterizePdf: vi.fn(), pdfParse: vi.fn(), extractPagesText: vi.fn(),
    })
    const settings = { ...LLX_SETTINGS, ocrEngine: 'vision', llmModel: 'gpt-4o-mini', ocrModel: 'gpt-4o' }
    registerLearningHandlers({ ipcMain, db: makeDb(settings), deps, mainWindow: null })

    await invoke('generate-ocr', { paperId: '2401.00001' })

    expect(deps.parsePdfWithLlamaParse).not.toHaveBeenCalled()
    expect(createLLM.mock.calls[0][0].llmModel).toBe('gpt-4o')
    expect(deps.transcribePdfToMarkdown).toHaveBeenCalledOnce()
  })

  it('without a LlamaParse key it keeps using the vision LLM as before', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const deps = llxDeps({
      createLLM: vi.fn().mockReturnValue({ transcribePageToMarkdown: vi.fn() }),
      transcribePdfToMarkdown: vi.fn().mockResolvedValue({ success: true, markdown: 'vision', pageCount: 1, fallbackUsed: false }),
      rasterizePdf: vi.fn(), pdfParse: vi.fn(), extractPagesText: vi.fn(),
    })
    registerLearningHandlers({ ipcMain, db: makeDb({ apiKey: 'sk-test' }), deps, mainWindow: null })

    await invoke('generate-ocr', { paperId: '2401.00001' })

    expect(deps.transcribePdfToMarkdown).toHaveBeenCalledOnce()
    expect(deps.parsePdfWithLlamaParse).not.toHaveBeenCalled()
  })
})

// ─── generate-ocr ──────────────────────────────────────────────────────────────

describe('generate-ocr (learning handler)', () => {
  let tmpDir, pdfFile
  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-ipc-'))
    pdfFile = path.join(tmpDir, 'raw.pdf')
    fs.writeFileSync(pdfFile, '%PDF-1.4 fake')
  })
  afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }))

  function baseDeps(overrides = {}) {
    return {
      createLLM: vi.fn().mockReturnValue({ transcribePageToMarkdown: vi.fn() }),
      vault: {
        pdfPath: vi.fn().mockReturnValue(pdfFile),
        writeOcr: vi.fn(),
        readOcr: vi.fn(),
      },
      rasterizePdf: vi.fn(),
      pdfParse: vi.fn(),
      extractPagesText: vi.fn(),
      OCR_MAX_CHARS: 200000,
      transcribePdfToMarkdown: vi.fn().mockResolvedValue({
        success: true, markdown: '# OCR text', pageCount: 3, fallbackUsed: false,
      }),
      ...overrides,
    }
  }

  it('runs OCR and persists pdf_text with pdf_text_source = ocr', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const db = {
      getAllSettings: vi.fn().mockReturnValue(SETTINGS),
      getPaper: vi.fn().mockReturnValue({ ...PAPER, pdf_text_source: 'pdf-parse' }),
      savePaper: vi.fn(),
    }
    const deps = baseDeps()
    registerLearningHandlers({ ipcMain, db, deps, mainWindow: null })

    const result = await invoke('generate-ocr', { paperId: '2401.00001' })

    expect(result.success).toBe(true)
    expect(deps.transcribePdfToMarkdown).toHaveBeenCalledOnce()
    expect(deps.vault.writeOcr).toHaveBeenCalledWith(expect.objectContaining({ id: '2401.00001' }), '# OCR text')
    expect(db.savePaper).toHaveBeenCalledWith(expect.objectContaining({
      pdf_text: '# OCR text', pdf_text_source: 'ocr', ocr_error: null,
    }))
  })

  it('records ocr_error when at least one page fell back', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const db = {
      getAllSettings: vi.fn().mockReturnValue(SETTINGS),
      getPaper: vi.fn().mockReturnValue(PAPER),
      savePaper: vi.fn(),
    }
    const deps = baseDeps({
      transcribePdfToMarkdown: vi.fn().mockResolvedValue({
        success: true, markdown: 'md', pageCount: 2, fallbackUsed: true,
      }),
    })
    registerLearningHandlers({ ipcMain, db, deps, mainWindow: null })

    await invoke('generate-ocr', { paperId: '2401.00001' })

    const saved = db.savePaper.mock.calls[0][0]
    expect(saved.pdf_text_source).toBe('ocr')
    expect(saved.ocr_error).toBeTruthy()
  })

  it('returns no-vision and does NOT overwrite pdf_text when the provider lacks vision', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const db = {
      getAllSettings: vi.fn().mockReturnValue(SETTINGS),
      getPaper: vi.fn().mockReturnValue({ ...PAPER, pdf_text: 'original pdf-parse text' }),
      savePaper: vi.fn(),
    }
    const deps = baseDeps({ createLLM: vi.fn().mockReturnValue({ chat: vi.fn() }) }) // no transcribePageToMarkdown
    registerLearningHandlers({ ipcMain, db, deps, mainWindow: null })

    const result = await invoke('generate-ocr', { paperId: '2401.00001' })

    expect(result.success).toBe(false)
    expect(result.error).toBe('no-vision')
    expect(deps.transcribePdfToMarkdown).not.toHaveBeenCalled()
    // pdf_text must be left intact
    const overwroteText = db.savePaper.mock.calls.some(c => 'pdf_text' in c[0] && c[0].pdf_text !== 'original pdf-parse text')
    expect(overwroteText).toBe(false)
  })

  it('reports progress to the renderer via ocr-progress', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const mockWindow = { webContents: { send: vi.fn() } }
    const db = {
      getAllSettings: vi.fn().mockReturnValue(SETTINGS),
      getPaper: vi.fn().mockReturnValue(PAPER),
      savePaper: vi.fn(),
    }
    const deps = baseDeps({
      transcribePdfToMarkdown: vi.fn(async (_buf, opts) => {
        opts.onProgress(1, 2); opts.onProgress(2, 2)
        return { success: true, markdown: 'md', pageCount: 2, fallbackUsed: false }
      }),
    })
    registerLearningHandlers({ ipcMain, db, deps, mainWindow: mockWindow })

    await invoke('generate-ocr', { paperId: '2401.00001' })

    expect(mockWindow.webContents.send).toHaveBeenCalledWith('ocr-progress', expect.objectContaining({ page: 1, total: 2 }))
  })

  it('does not pass an interpretFigures flag — figure interpretation is always-on in the orchestrator, not an opt-in here', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const db = {
      getAllSettings: vi.fn().mockReturnValue(SETTINGS),
      getPaper: vi.fn().mockReturnValue(PAPER),
      savePaper: vi.fn(),
    }
    const deps = baseDeps()
    registerLearningHandlers({ ipcMain, db, deps, mainWindow: null })

    await invoke('generate-ocr', { paperId: '2401.00001' })

    const opts = deps.transcribePdfToMarkdown.mock.calls[0][1]
    expect(opts).not.toHaveProperty('interpretFigures')
  })

  it('returns not-found when the paper does not exist', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const db = { getAllSettings: vi.fn().mockReturnValue(SETTINGS), getPaper: vi.fn().mockReturnValue(null), savePaper: vi.fn() }
    registerLearningHandlers({ ipcMain, db, deps: baseDeps(), mainWindow: null })
    const result = await invoke('generate-ocr', { paperId: 'nope' })
    expect(result.success).toBe(false)
    expect(result.error).toBe('not-found')
  })
})

// ─── reload-ocr-from-file ───────────────────────────────────────────────────────

describe('reload-ocr-from-file (learning handler)', () => {
  it('resyncs pdf_text from the edited ocr file without calling the LLM', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const db = {
      getAllSettings: vi.fn().mockReturnValue(SETTINGS),
      getPaper: vi.fn().mockReturnValue(PAPER),
      savePaper: vi.fn(),
    }
    const createLLM = vi.fn()
    const deps = {
      createLLM,
      vault: { readOcr: vi.fn().mockReturnValue('# Edited OCR\ncorrected table') },
      OCR_MAX_CHARS: 200000,
    }
    registerLearningHandlers({ ipcMain, db, deps, mainWindow: null })

    const result = await invoke('reload-ocr-from-file', '2401.00001')

    expect(result.success).toBe(true)
    expect(createLLM).not.toHaveBeenCalled()
    expect(db.savePaper).toHaveBeenCalledWith(expect.objectContaining({
      pdf_text: '# Edited OCR\ncorrected table', pdf_text_source: 'ocr',
    }))
  })

  it('returns no-file when there is no ocr file on disk', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const db = { getAllSettings: vi.fn().mockReturnValue(SETTINGS), getPaper: vi.fn().mockReturnValue(PAPER), savePaper: vi.fn() }
    const deps = { createLLM: vi.fn(), vault: { readOcr: vi.fn().mockReturnValue(null) }, OCR_MAX_CHARS: 200000 }
    registerLearningHandlers({ ipcMain, db, deps, mainWindow: null })

    const result = await invoke('reload-ocr-from-file', '2401.00001')
    expect(result.success).toBe(false)
    expect(result.error).toBe('no-file')
    expect(db.savePaper).not.toHaveBeenCalled()
  })
})
