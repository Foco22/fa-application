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
