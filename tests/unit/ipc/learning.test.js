import { describe, it, expect, vi } from 'vitest'
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
