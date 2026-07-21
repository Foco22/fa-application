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
  abstract: 'Abstract.', pdf_text: 'Full text.',
  summary: null, quiz: null,
}

const SETTINGS = { apiKey: 'sk-test' }

// ─── chat-message ─────────────────────────────────────────────────────────────

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
    expect(deps.chatWithPaper).toHaveBeenCalledWith('Explica el método', PAPER, [], mockLLM)
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

    expect(deps.chatWithPaper).toHaveBeenCalledWith('hola', null, [], expect.anything())
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

    expect(deps.chatWithPaper).toHaveBeenCalledWith('hola', null, [], expect.anything())
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

  it('passes interpretFigures through to the orchestrator (opt-in)', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const db = {
      getAllSettings: vi.fn().mockReturnValue(SETTINGS),
      getPaper: vi.fn().mockReturnValue(PAPER),
      savePaper: vi.fn(),
    }
    const deps = baseDeps()
    registerLearningHandlers({ ipcMain, db, deps, mainWindow: null })

    await invoke('generate-ocr', { paperId: '2401.00001', interpretFigures: true })

    expect(deps.transcribePdfToMarkdown).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ interpretFigures: true }))
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
