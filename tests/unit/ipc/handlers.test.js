import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerHandlers } from '../../../src/ipc/index.js'

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeIpcMain() {
  const handlers = {}
  return {
    ipcMain:  { handle: (ch, fn) => { handlers[ch] = fn } },
    invoke:   (ch, ...args) => handlers[ch]({}, ...args),
    handlers
  }
}

const EVENT = {}

// ─── fixture data ─────────────────────────────────────────────────────────────

const PAPER = {
  id: '2401.00001', title: 'Test Paper', authors: 'Alice',
  abstract: 'Abstract.', pdf_url: 'https://arxiv.org/pdf/2401.00001',
  published_date: '2024-01-09', affiliations: '[]',
  pdf_text: null, summary: null, quiz: null, pdf_error: null, status: 'new'
}

const SETTINGS = {
  apiKey: 'sk-ant-test', categoryList: 'cs.AI', authorList: '',
  universityList: 'MIT\nStanford', maxPapers: '3',
  fetchDay: 'monday', fetchHour: '09:00', userName: 'Francisco',
  semanticScholarApiKey: ''
}

const VALID_QUIZ = {
  questions: Array(5).fill({
    question: 'Q?', options: ['A','B','C','D'], correct: 0, explanation: 'E.'
  })
}

// ─── get-papers ───────────────────────────────────────────────────────────────

describe('get-papers', () => {
  it('returns all papers from the database', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const db = { getPapers: vi.fn().mockReturnValue([PAPER]), getAllSettings: vi.fn().mockReturnValue(SETTINGS) }
    registerHandlers({ ipcMain, db, deps: {} })

    const result = await invoke('get-papers')
    expect(db.getPapers).toHaveBeenCalledOnce()
    expect(result).toEqual([PAPER])
  })
})

// ─── get-paper ────────────────────────────────────────────────────────────────

describe('get-paper', () => {
  it('returns a single paper by id', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const db = { getPaper: vi.fn().mockReturnValue(PAPER), getAllSettings: vi.fn().mockReturnValue(SETTINGS) }
    registerHandlers({ ipcMain, db, deps: {} })

    const result = await invoke('get-paper', '2401.00001')
    expect(db.getPaper).toHaveBeenCalledWith('2401.00001')
    expect(result).toEqual(PAPER)
  })
})

// ─── get-settings / save-settings ────────────────────────────────────────────

describe('get-settings', () => {
  it('returns all settings as an object', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const db = { getAllSettings: vi.fn().mockReturnValue(SETTINGS) }
    registerHandlers({ ipcMain, db, deps: {} })

    const result = await invoke('get-settings')
    expect(db.getAllSettings).toHaveBeenCalledOnce()
    expect(result).toEqual(SETTINGS)
  })
})

describe('save-settings', () => {
  it('calls saveSetting for each key in the payload', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const db = { saveSetting: vi.fn(), getAllSettings: vi.fn().mockReturnValue(SETTINGS) }
    registerHandlers({ ipcMain, db, deps: {} })

    await invoke('save-settings', { apiKey: 'new-key', maxPapers: '5' })
    expect(db.saveSetting).toHaveBeenCalledWith('apiKey', 'new-key')
    expect(db.saveSetting).toHaveBeenCalledWith('maxPapers', '5')
  })

  it('returns { success: true } on completion', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const db = { saveSetting: vi.fn(), getAllSettings: vi.fn().mockReturnValue(SETTINGS) }
    registerHandlers({ ipcMain, db, deps: {} })

    const result = await invoke('save-settings', { apiKey: 'x' })
    expect(result).toEqual({ success: true })
  })
})

// ─── check-onboarding ────────────────────────────────────────────────────────

describe('check-onboarding', () => {
  it('returns true when userName is set', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const db = { getSetting: vi.fn().mockReturnValue('Francisco'), getAllSettings: vi.fn().mockReturnValue(SETTINGS) }
    registerHandlers({ ipcMain, db, deps: {} })

    expect(await invoke('check-onboarding')).toBe(true)
  })

  it('returns false when userName is not set', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const db = { getSetting: vi.fn().mockReturnValue(undefined), getAllSettings: vi.fn().mockReturnValue(SETTINGS) }
    registerHandlers({ ipcMain, db, deps: {} })

    expect(await invoke('check-onboarding')).toBe(false)
  })

  it('returns false when userName is an empty string', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const db = { getSetting: vi.fn().mockReturnValue(''), getAllSettings: vi.fn().mockReturnValue(SETTINGS) }
    registerHandlers({ ipcMain, db, deps: {} })

    expect(await invoke('check-onboarding')).toBe(false)
  })
})

// ─── save-quiz-result ─────────────────────────────────────────────────────────

describe('save-quiz-result', () => {
  it('calls db.saveQuizResult with the payload', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const db = { saveQuizResult: vi.fn(), getAllSettings: vi.fn().mockReturnValue(SETTINGS) }
    registerHandlers({ ipcMain, db, deps: {} })

    const payload = { paper_id: '2401.00001', score: 4, total: 5, answers: '[]' }
    await invoke('save-quiz-result', payload)
    expect(db.saveQuizResult).toHaveBeenCalledWith(payload)
  })

  it('returns { success: true }', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const db = { saveQuizResult: vi.fn(), getAllSettings: vi.fn().mockReturnValue(SETTINGS) }
    registerHandlers({ ipcMain, db, deps: {} })

    const result = await invoke('save-quiz-result', { paper_id: 'x', score: 3, total: 5, answers: '[]' })
    expect(result).toEqual({ success: true })
  })
})

// ─── generate-quiz ────────────────────────────────────────────────────────────

describe('generate-quiz', () => {
  it('calls generateQuiz with the paper and returns the quiz', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const mockGenerateQuiz = vi.fn().mockResolvedValue(VALID_QUIZ)
    const db = {
      getPaper: vi.fn().mockReturnValue(PAPER),
      savePaper: vi.fn(),
      getAllSettings: vi.fn().mockReturnValue(SETTINGS)
    }
    const deps = {
      createLLM: vi.fn().mockReturnValue({ generateQuiz: mockGenerateQuiz }),
      vault: { writeQuiz: vi.fn() },
    }
    registerHandlers({ ipcMain, db, deps })

    const result = await invoke('generate-quiz', '2401.00001')
    expect(mockGenerateQuiz).toHaveBeenCalledOnce()
    expect(result.questions).toHaveLength(5)
  })

  it('persists the quiz JSON to the paper record', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const mockGenerateQuiz = vi.fn().mockResolvedValue(VALID_QUIZ)
    const db = {
      getPaper: vi.fn().mockReturnValue(PAPER),
      savePaper: vi.fn(),
      getAllSettings: vi.fn().mockReturnValue(SETTINGS)
    }
    const deps = {
      createLLM: vi.fn().mockReturnValue({ generateQuiz: mockGenerateQuiz }),
      vault: { writeQuiz: vi.fn() },
    }
    registerHandlers({ ipcMain, db, deps })

    await invoke('generate-quiz', '2401.00001')
    expect(db.savePaper).toHaveBeenCalledWith(
      expect.objectContaining({ quiz: JSON.stringify(VALID_QUIZ) })
    )
  })
})

// ─── start-summary ────────────────────────────────────────────────────────────

describe('start-summary', () => {
  it('calls streamSummary and sends chunks to the window', async () => {
    const { ipcMain, handlers } = makeIpcMain()
    const mockStreamSummary = vi.fn().mockImplementation(async (paper, onChunk) => {
      onChunk('chunk1')
      onChunk('chunk2')
      return 'chunk1chunk2'
    })
    const mockWindow = { webContents: { send: vi.fn() } }
    const db = {
      getPaper: vi.fn().mockReturnValue(PAPER),
      savePaper: vi.fn(),
      getAllSettings: vi.fn().mockReturnValue(SETTINGS)
    }
    const deps = {
      createLLM: vi.fn().mockReturnValue({ streamSummary: mockStreamSummary }),
      vault: { writeSummary: vi.fn() },
    }
    registerHandlers({ ipcMain, db, deps, mainWindow: mockWindow })

    await handlers['start-summary'](EVENT, '2401.00001')

    expect(mockWindow.webContents.send).toHaveBeenCalledWith('summary-chunk', 'chunk1')
    expect(mockWindow.webContents.send).toHaveBeenCalledWith('summary-chunk', 'chunk2')
    expect(mockWindow.webContents.send).toHaveBeenCalledWith('summary-done')
  })

  it('sends summary-error when streamSummary throws', async () => {
    const { ipcMain, handlers } = makeIpcMain()
    const mockStreamSummary = vi.fn().mockRejectedValue(new Error('API error'))
    const mockWindow = { webContents: { send: vi.fn() } }
    const db = {
      getPaper: vi.fn().mockReturnValue(PAPER),
      getAllSettings: vi.fn().mockReturnValue(SETTINGS)
    }
    const deps = {
      createLLM: vi.fn().mockReturnValue({ streamSummary: mockStreamSummary }),
      vault: { writeSummary: vi.fn() },
    }
    registerHandlers({ ipcMain, db, deps, mainWindow: mockWindow })

    await handlers['start-summary'](EVENT, '2401.00001')

    expect(mockWindow.webContents.send).toHaveBeenCalledWith('summary-error', 'API error')
  })

  it('persists the completed summary to the paper record', async () => {
    const { ipcMain, handlers } = makeIpcMain()
    const mockStreamSummary = vi.fn().mockResolvedValue('full summary text')
    const mockWindow = { webContents: { send: vi.fn() } }
    const db = {
      getPaper: vi.fn().mockReturnValue(PAPER),
      savePaper: vi.fn(),
      getAllSettings: vi.fn().mockReturnValue(SETTINGS)
    }
    const deps = {
      createLLM: vi.fn().mockReturnValue({ streamSummary: mockStreamSummary }),
      vault: { writeSummary: vi.fn() },
    }
    registerHandlers({ ipcMain, db, deps, mainWindow: mockWindow })

    await handlers['start-summary'](EVENT, '2401.00001')

    expect(db.savePaper).toHaveBeenCalledWith(
      expect.objectContaining({ summary: 'full summary text' })
    )
  })
})