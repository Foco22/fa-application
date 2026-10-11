import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { registerClassHandlers } from '../../../src/ipc/class.js'

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeIpcMain() {
  const handlers = {}
  return {
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn } },
    invoke:  (ch, ...args) => handlers[ch]({}, ...args),
    handlers,
  }
}

function makeMainWindow() {
  return { webContents: { send: vi.fn() } }
}

function makeDb(overrides = {}) {
  return {
    getAllSettings: vi.fn().mockReturnValue({ apiKey: 'sk-test' }),
    getPaper:      vi.fn().mockReturnValue(null),
    ...overrides
  }
}

function makeWhisperStreamProc() {
  return { start: vi.fn(), stop: vi.fn() }
}

// ─── temp models dir fixture ──────────────────────────────────────────────────

let tmpModelsDir

beforeEach(() => {
  tmpModelsDir = join(tmpdir(), `wtest-${Date.now()}`)
  mkdirSync(tmpModelsDir, { recursive: true })
  writeFileSync(join(tmpModelsDir, 'ggml-small.bin'), '')
  writeFileSync(join(tmpModelsDir, 'ggml-base.bin'),  '')
})

afterEach(() => {
  rmSync(tmpModelsDir, { recursive: true, force: true })
})

// ─── class-start-stream ───────────────────────────────────────────────────────

describe('class-start-stream', () => {
  it('returns error when whisperStreamBin is not configured', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const deps = {
      createLLM: vi.fn(), createTranscription: vi.fn(),
      createWhisperStream: vi.fn(),
      whisperStreamBin: null,
      whisperModelsDir: tmpModelsDir,
    }
    registerClassHandlers({ ipcMain, db: makeDb(), deps, mainWindow: makeMainWindow() })
    const result = await invoke('class-start-stream', { language: 'es' })
    expect(result.error).toBeTruthy()
    expect(deps.createWhisperStream).not.toHaveBeenCalled()
  })

  it('returns error when whisperModelsDir is not configured', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const deps = {
      createLLM: vi.fn(), createTranscription: vi.fn(),
      createWhisperStream: vi.fn(),
      whisperStreamBin: '/bin/stream',
      whisperModelsDir: null,
    }
    registerClassHandlers({ ipcMain, db: makeDb(), deps, mainWindow: makeMainWindow() })
    const result = await invoke('class-start-stream', { language: 'es' })
    expect(result.error).toBeTruthy()
    expect(deps.createWhisperStream).not.toHaveBeenCalled()
  })

  it('returns error when model file does not exist', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const deps = {
      createLLM: vi.fn(), createTranscription: vi.fn(),
      createWhisperStream: vi.fn(),
      whisperStreamBin: '/bin/stream',
      whisperModelsDir: tmpModelsDir,
    }
    registerClassHandlers({ ipcMain, db: makeDb(), deps, mainWindow: makeMainWindow() })
    const result = await invoke('class-start-stream', { language: 'es', localModel: 'medium' })
    expect(result.error).toMatch(/medium/)
    expect(deps.createWhisperStream).not.toHaveBeenCalled()
  })

  it('creates a whisper stream with the correct model path', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const ws = makeWhisperStreamProc()
    const deps = {
      createLLM: vi.fn(), createTranscription: vi.fn(),
      createWhisperStream: vi.fn().mockReturnValue(ws),
      whisperStreamBin: '/bin/stream',
      whisperModelsDir: tmpModelsDir,
    }
    registerClassHandlers({ ipcMain, db: makeDb(), deps, mainWindow: makeMainWindow() })
    const result = await invoke('class-start-stream', { language: 'en', localModel: 'small' })
    expect(result.ok).toBe(true)
    expect(deps.createWhisperStream).toHaveBeenCalledWith(
      '/bin/stream',
      join(tmpModelsDir, 'ggml-small.bin')
    )
    expect(ws.start).toHaveBeenCalledWith(expect.objectContaining({ language: 'en' }))
  })

  it('defaults to small model when localModel is not provided', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const ws = makeWhisperStreamProc()
    const deps = {
      createLLM: vi.fn(), createTranscription: vi.fn(),
      createWhisperStream: vi.fn().mockReturnValue(ws),
      whisperStreamBin: '/bin/stream',
      whisperModelsDir: tmpModelsDir,
    }
    registerClassHandlers({ ipcMain, db: makeDb(), deps, mainWindow: makeMainWindow() })
    await invoke('class-start-stream', {})
    expect(deps.createWhisperStream).toHaveBeenCalledWith(
      '/bin/stream',
      join(tmpModelsDir, 'ggml-small.bin')
    )
  })

  it('defaults language to es when not provided', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const ws = makeWhisperStreamProc()
    const deps = {
      createLLM: vi.fn(), createTranscription: vi.fn(),
      createWhisperStream: vi.fn().mockReturnValue(ws),
      whisperStreamBin: '/bin/stream',
      whisperModelsDir: tmpModelsDir,
    }
    registerClassHandlers({ ipcMain, db: makeDb(), deps, mainWindow: makeMainWindow() })
    await invoke('class-start-stream', {})
    expect(ws.start).toHaveBeenCalledWith(expect.objectContaining({ language: 'es' }))
  })

  it('sends class-stream-text to renderer when onText callback fires', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const mainWindow = makeMainWindow()
    let capturedOnText = null
    const ws = { start: vi.fn(({ onText }) => { capturedOnText = onText }), stop: vi.fn() }
    const deps = {
      createLLM: vi.fn(), createTranscription: vi.fn(),
      createWhisperStream: vi.fn().mockReturnValue(ws),
      whisperStreamBin: '/bin/stream',
      whisperModelsDir: tmpModelsDir,
    }
    registerClassHandlers({ ipcMain, db: makeDb(), deps, mainWindow })
    await invoke('class-start-stream', { language: 'es' })
    capturedOnText('Hola mundo')
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('class-stream-text', 'Hola mundo')
  })

  it('stops any previously running stream before starting a new one', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const ws1 = makeWhisperStreamProc()
    const ws2 = makeWhisperStreamProc()
    let callCount = 0
    const deps = {
      createLLM: vi.fn(), createTranscription: vi.fn(),
      createWhisperStream: vi.fn().mockImplementation(() => callCount++ === 0 ? ws1 : ws2),
      whisperStreamBin: '/bin/stream',
      whisperModelsDir: tmpModelsDir,
    }
    registerClassHandlers({ ipcMain, db: makeDb(), deps, mainWindow: makeMainWindow() })
    await invoke('class-start-stream', { language: 'es' })
    await invoke('class-start-stream', { language: 'es' })
    expect(ws1.stop).toHaveBeenCalledTimes(1)
    expect(ws2.start).toHaveBeenCalledTimes(1)
  })
})

// ─── class-stop-stream ────────────────────────────────────────────────────────

describe('class-stop-stream', () => {
  it('stops the running whisper stream', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const ws = makeWhisperStreamProc()
    const deps = {
      createLLM: vi.fn(), createTranscription: vi.fn(),
      createWhisperStream: vi.fn().mockReturnValue(ws),
      whisperStreamBin: '/bin/stream',
      whisperModelsDir: tmpModelsDir,
    }
    registerClassHandlers({ ipcMain, db: makeDb(), deps, mainWindow: makeMainWindow() })
    await invoke('class-start-stream', { language: 'es' })
    const result = await invoke('class-stop-stream')
    expect(ws.stop).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(true)
  })

  it('is safe to call when no stream is running', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const deps = {
      createLLM: vi.fn(), createTranscription: vi.fn(),
      createWhisperStream: vi.fn(),
      whisperStreamBin: '/bin/stream',
      whisperModelsDir: tmpModelsDir,
    }
    registerClassHandlers({ ipcMain, db: makeDb(), deps, mainWindow: makeMainWindow() })
    const result = await invoke('class-stop-stream')
    expect(result.ok).toBe(true)
  })
})

// ─── class-transcribe-audio (existing, unchanged) ────────────────────────────

describe('class-transcribe-audio', () => {
  it('calls createTranscription with the openai api key', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const mockTranscription = { transcribe: vi.fn().mockResolvedValue({ text: 'hola' }) }
    const deps = {
      createLLM: vi.fn(), createTranscription: vi.fn().mockReturnValue(mockTranscription),
      createWhisperStream: vi.fn(),
      whisperStreamBin: null, whisperModelsDir: null,
    }
    const db = makeDb({ getAllSettings: vi.fn().mockReturnValue({ openaiApiKey: 'sk-openai', apiKey: 'sk-fallback' }) })
    registerClassHandlers({ ipcMain, db, deps, mainWindow: makeMainWindow() })

    const result = await invoke('class-transcribe-audio', {
      audio: [1, 2, 3], mimeType: 'audio/webm', language: 'es', model: 'gpt-4o-mini-transcribe'
    })
    expect(deps.createTranscription).toHaveBeenCalledWith('sk-openai', { model: 'gpt-4o-mini-transcribe' })
    expect(result.text).toBe('hola')
  })

  it('falls back to apiKey when openaiApiKey is not set', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const mockTranscription = { transcribe: vi.fn().mockResolvedValue({ text: 'test' }) }
    const deps = {
      createLLM: vi.fn(), createTranscription: vi.fn().mockReturnValue(mockTranscription),
      createWhisperStream: vi.fn(),
      whisperStreamBin: null, whisperModelsDir: null,
    }
    const db = makeDb({ getAllSettings: vi.fn().mockReturnValue({ apiKey: 'sk-only' }) })
    registerClassHandlers({ ipcMain, db, deps, mainWindow: makeMainWindow() })

    await invoke('class-transcribe-audio', { audio: [1, 2, 3], mimeType: 'audio/webm' })
    expect(deps.createTranscription).toHaveBeenCalledWith('sk-only', expect.anything())
  })

  it('returns error object when no api key is configured', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const deps = {
      createLLM: vi.fn(), createTranscription: vi.fn(),
      createWhisperStream: vi.fn(),
      whisperStreamBin: null, whisperModelsDir: null,
    }
    const db = makeDb({ getAllSettings: vi.fn().mockReturnValue({}) })
    registerClassHandlers({ ipcMain, db, deps, mainWindow: makeMainWindow() })

    const result = await invoke('class-transcribe-audio', { audio: [1, 2, 3] })
    expect(result.error).toBeTruthy()
    expect(result.text).toBeNull()
  })
})

// ─── createClassLLM consolidation (settings-redesign: Clase usa el LLM principal) ─

describe('createClassLLM (Class mode uses the main LLM config, no per-Class override)', () => {
  it('calls createLLM with the settings object unchanged, ignoring classLlmProvider/classLlmModel/classApiKey', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const mockLlm = { chat: vi.fn().mockResolvedValue('respuesta') }
    const deps = {
      createLLM: vi.fn().mockReturnValue(mockLlm),
      createTranscription: vi.fn(), createWhisperStream: vi.fn(),
      whisperStreamBin: null, whisperModelsDir: null,
    }
    const settings = {
      llmProvider: 'anthropic', llmModel: 'claude-opus-4-8', apiKey: 'sk-main',
      classLlmProvider: 'deepseek', classLlmModel: 'deepseek-v4-flash', classApiKey: 'sk-class',
    }
    const db = makeDb({ getAllSettings: vi.fn().mockReturnValue(settings) })
    registerClassHandlers({ ipcMain, db, deps, mainWindow: makeMainWindow() })

    await invoke('class-assistant-message', {
      question: '¿Qué es un transformer?', missing: null, excerpts: [], history: [],
      canRevealAnswer: false, llmProvider: 'openai', llmModel: 'gpt-4o',
    })

    expect(deps.createLLM).toHaveBeenCalledWith(settings)
  })

  it('ignores llmProvider/llmModel passed in the IPC payload (no per-request override)', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const mockLlm = { chat: vi.fn().mockResolvedValue('ok') }
    const deps = {
      createLLM: vi.fn().mockReturnValue(mockLlm),
      createTranscription: vi.fn(), createWhisperStream: vi.fn(),
      whisperStreamBin: null, whisperModelsDir: null,
    }
    const settings = { llmProvider: 'openai', llmModel: 'gpt-4o', apiKey: 'sk-main' }
    const db = makeDb({ getAllSettings: vi.fn().mockReturnValue(settings) })
    registerClassHandlers({ ipcMain, db, deps, mainWindow: makeMainWindow() })

    await invoke('class-assistant-message', {
      question: 'q', missing: null, excerpts: [], history: [], canRevealAnswer: false,
      llmProvider: 'deepseek', llmModel: 'deepseek-v4-flash',
    })

    expect(deps.createLLM).toHaveBeenCalledWith(settings)
    expect(deps.createLLM).not.toHaveBeenCalledWith(expect.objectContaining({ llmProvider: 'deepseek' }))
  })
})

// ─── class-upload-slides ──────────────────────────────────────────────────────

describe('class-upload-slides', () => {
  function makeSlidesDb() {
    let sid = 0
    return makeDb({
      getPaper:           vi.fn().mockReturnValue({ id: '2401.99999' }),
      createClassSession: vi.fn().mockReturnValue({ id: 'sess-1' }),
      saveClassSlide:     vi.fn().mockImplementation(() => ({ id: ++sid })),
    })
  }

  it('persists each uploaded slide to the vault via deps.vault.writeSlide', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const vault = { writeSlide: vi.fn() }
    const deps = {
      createLLM: vi.fn(), createTranscription: vi.fn(), createWhisperStream: vi.fn(),
      whisperStreamBin: null, whisperModelsDir: null, vault,
    }
    const db = makeSlidesDb()
    registerClassHandlers({ ipcMain, db, deps, mainWindow: makeMainWindow() })

    const jpg = Buffer.from('one').toString('base64')
    const png = Buffer.from('two').toString('base64')
    const result = await invoke('class-upload-slides', {
      paperId: '2401.99999', duration: 10,
      slides: [
        { imageData: jpg, mimeType: 'image/jpeg' },
        { imageData: png, mimeType: 'image/png' },
      ],
    })

    expect(result.sessionId).toBe('sess-1')
    expect(result.slideIds).toEqual([1, 2])
    expect(vault.writeSlide).toHaveBeenCalledTimes(2)
    expect(vault.writeSlide).toHaveBeenNthCalledWith(1, { id: '2401.99999' }, 'slide-01.jpg', Buffer.from('one'))
    expect(vault.writeSlide).toHaveBeenNthCalledWith(2, { id: '2401.99999' }, 'slide-02.png', Buffer.from('two'))
  })

  it('still saves to the DB when the vault write fails', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const vault = { writeSlide: vi.fn(() => { throw new Error('disk full') }) }
    const deps = {
      createLLM: vi.fn(), createTranscription: vi.fn(), createWhisperStream: vi.fn(),
      whisperStreamBin: null, whisperModelsDir: null, vault,
    }
    const db = makeSlidesDb()
    registerClassHandlers({ ipcMain, db, deps, mainWindow: makeMainWindow() })

    const result = await invoke('class-upload-slides', {
      paperId: '2401.99999', duration: 10,
      slides: [{ imageData: Buffer.from('x').toString('base64'), mimeType: 'image/jpeg' }],
    })
    expect(result.slideIds).toEqual([1])
    expect(db.saveClassSlide).toHaveBeenCalledOnce()
  })

  it('does not throw when deps.vault is not provided', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const deps = {
      createLLM: vi.fn(), createTranscription: vi.fn(), createWhisperStream: vi.fn(),
      whisperStreamBin: null, whisperModelsDir: null,
    }
    const db = makeSlidesDb()
    registerClassHandlers({ ipcMain, db, deps, mainWindow: makeMainWindow() })
    const result = await invoke('class-upload-slides', {
      paperId: '2401.99999', duration: 10,
      slides: [{ imageData: Buffer.from('x').toString('base64'), mimeType: 'image/jpeg' }],
    })
    expect(result.slideIds).toEqual([1])
  })
})

// ─── slides escritas en markdown dentro de la app ────────────────────────────

describe('class-upload-slides — markdown slides', () => {
  function makeMdDb() {
    let sid = 0
    return makeDb({
      getPaper:           vi.fn().mockReturnValue({ id: '2401.99999' }),
      createClassSession: vi.fn().mockReturnValue({ id: 'sess-1' }),
      saveClassSlide:     vi.fn().mockImplementation(() => ({ id: ++sid })),
      updateClassSlideInterpretation: vi.fn(),
    })
  }
  const baseDeps = (extra = {}) => ({
    createLLM: vi.fn(), createTranscription: vi.fn(), createWhisperStream: vi.fn(),
    whisperStreamBin: null, whisperModelsDir: null, ...extra,
  })

  it('saves markdown slides with their text and auto labels', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const db = makeMdDb()
    registerClassHandlers({ ipcMain, db, deps: baseDeps(), mainWindow: makeMainWindow() })

    await invoke('class-upload-slides', {
      paperId: '2401.99999', duration: 180,
      slides: [{ markdown: '# Intro' }, { markdown: '# Medio' }, { markdown: '# Fin' }],
    })

    expect(db.saveClassSlide).toHaveBeenNthCalledWith(1, expect.objectContaining({ markdown: '# Intro', label: 'intro', order_index: 0 }))
    expect(db.saveClassSlide).toHaveBeenNthCalledWith(2, expect.objectContaining({ markdown: '# Medio', label: 'desarrollo' }))
    expect(db.saveClassSlide).toHaveBeenNthCalledWith(3, expect.objectContaining({ markdown: '# Fin', label: 'conclusion' }))
  })

  it('uses the markdown itself as the interpretation (no vision call needed)', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const db = makeMdDb()
    registerClassHandlers({ ipcMain, db, deps: baseDeps(), mainWindow: makeMainWindow() })

    await invoke('class-upload-slides', { paperId: '2401.99999', duration: 180, slides: [{ markdown: '# Intro\n- punto' }] })

    expect(db.updateClassSlideInterpretation).toHaveBeenCalledWith(1, '# Intro\n- punto')
  })

  it('writes the whole deck to the vault as a single slides.md', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const vault = { writeSlide: vi.fn() }
    const db = makeMdDb()
    registerClassHandlers({ ipcMain, db, deps: baseDeps({ vault }), mainWindow: makeMainWindow() })

    await invoke('class-upload-slides', {
      paperId: '2401.99999', duration: 180,
      slides: [{ markdown: '# A' }, { markdown: '# B' }],
    })

    expect(vault.writeSlide).toHaveBeenCalledOnce()
    expect(vault.writeSlide).toHaveBeenCalledWith({ id: '2401.99999' }, 'slides.md', Buffer.from('# A\n\n---\n\n# B\n', 'utf8'))
  })
})

describe('class-interpret-slides', () => {
  it('skips slides that already have an interpretation (markdown slides) and keeps it', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const llm = { interpretImage: vi.fn().mockResolvedValue('una imagen') }
    const db = makeDb({
      getClassSlides: vi.fn().mockReturnValue([
        { id: 1, image_data: '', mime_type: 'text/markdown', markdown: '# A', interpretation: '# A' },
        { id: 2, image_data: 'AAA', mime_type: 'image/jpeg', interpretation: null },
      ]),
      updateClassSlideInterpretation: vi.fn(),
    })
    const deps = {
      createLLM: vi.fn().mockReturnValue(llm), createTranscription: vi.fn(), createWhisperStream: vi.fn(),
      whisperStreamBin: null, whisperModelsDir: null,
    }
    registerClassHandlers({ ipcMain, db, deps, mainWindow: makeMainWindow() })

    const result = await invoke('class-interpret-slides', { sessionId: 's1' })

    expect(llm.interpretImage).toHaveBeenCalledOnce()
    expect(llm.interpretImage).toHaveBeenCalledWith('AAA', 'image/jpeg')
    expect(result.slides).toEqual([
      { id: 1, interpretation: '# A' },
      { id: 2, interpretation: 'una imagen' },
    ])
  })
})

describe('class-save-slides-draft', () => {
  it('persists the markdown draft for the paper', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const db = makeDb({ saveSlidesDraft: vi.fn() })
    registerClassHandlers({ ipcMain, db, deps: { createLLM: vi.fn() }, mainWindow: makeMainWindow() })

    const res = await invoke('class-save-slides-draft', { paperId: 'p1', markdown: '# x' })
    expect(db.saveSlidesDraft).toHaveBeenCalledWith('p1', '# x')
    expect(res).toEqual({ ok: true })
  })
})

describe('class-pick-pdf', () => {
  it('opens a PDF-only file dialog via deps.dialog and returns a file:// url + name', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const dialog = { showOpenDialog: vi.fn().mockResolvedValue({ canceled: false, filePaths: [join(tmpdir(), 'mis notas.pdf')] }) }
    registerClassHandlers({ ipcMain, db: makeDb(), deps: { createLLM: vi.fn(), dialog }, mainWindow: makeMainWindow() })

    const res = await invoke('class-pick-pdf')

    expect(dialog.showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({
      properties: ['openFile'],
      filters: [expect.objectContaining({ extensions: ['pdf'] })],
    }))
    expect(res.name).toBe('mis notas.pdf')
    expect(res.url).toMatch(/^file:\/\//)
    expect(res.url).toContain('mis%20notas.pdf')
  })

  it('returns null when the dialog is canceled', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const dialog = { showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }) }
    registerClassHandlers({ ipcMain, db: makeDb(), deps: { createLLM: vi.fn(), dialog }, mainWindow: makeMainWindow() })
    expect(await invoke('class-pick-pdf')).toBeNull()
  })
})

describe('class-student-evaluate', () => {
  it('returns NOT satisfied when evaluation throws, so the student keeps the turn', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const db = makeDb({
      getPaper: vi.fn(() => { throw new Error('db down') }),
      getClassSlides: vi.fn().mockReturnValue([]),
    })
    registerClassHandlers({ ipcMain, db, deps: { createLLM: vi.fn().mockReturnValue({ chat: vi.fn() }) }, mainWindow: makeMainWindow() })
    const r = await invoke('class-student-evaluate', { studentId: 1, paperId: 'p', sessionId: 's', professorAnswer: 'x', history: [], exchangeCount: 1 })
    expect(r.satisfied).toBe(false)
  })
})

describe('class-student-evaluate — reference answer', () => {
  it('builds the reference answer once per question and reuses it on later attempts', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const chat = vi.fn()
      .mockResolvedValueOnce('La respuesta correcta según el paper.')          // referencia
      .mockResolvedValueOnce('{"passed": false, "missing": "el porqué"}')     // evaluador, intento 1
      .mockResolvedValueOnce('¿Y por qué?')                                    // reacción 1
      .mockResolvedValueOnce('{"passed": true, "missing": null}')             // evaluador, intento 2
      .mockResolvedValueOnce('Gracias')                                        // reacción 2
    const db = makeDb({ getPaper: vi.fn().mockReturnValue({ id: 'p', title: 'T', pdf_text: 'texto' }), getClassSlides: vi.fn().mockReturnValue([]) })
    registerClassHandlers({ ipcMain, db, deps: { createLLM: vi.fn().mockReturnValue({ chat }) }, mainWindow: makeMainWindow() })

    const q = '¿Qué propone el paper?'
    const r1 = await invoke('class-student-evaluate', { studentId: 1, paperId: 'p', sessionId: 's', professorAnswer: 'un modelo nuevo', history: [{ question: q, answer: 'un modelo nuevo' }], exchangeCount: 1 })
    const r2 = await invoke('class-student-evaluate', { studentId: 1, paperId: 'p', sessionId: 's', professorAnswer: 'el GRU, porque...', history: [{ question: q, answer: 'un modelo nuevo' }, { question: '¿Y por qué?', answer: 'el GRU, porque...' }], exchangeCount: 2 })

    expect(r1.satisfied).toBe(false)
    expect(r2.satisfied).toBe(true)
    expect(chat).toHaveBeenCalledTimes(5)
    const judge2 = chat.mock.calls[3][0].map(m => m.content).join('\n')
    expect(judge2).toContain('La respuesta correcta según el paper.')
  })
})
