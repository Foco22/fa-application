import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { createWhisperStream, filterLine } from '../../../src/transcription/whisper-stream.js'

function makeProcess() {
  const proc = new EventEmitter()
  proc.stdout = new PassThrough()
  proc.stderr = new PassThrough()
  proc.kill   = vi.fn()
  return proc
}

// Helper: push data and wait for event loop to flush data handlers
async function push(proc, data) {
  proc.stdout.push(data)
  await new Promise(resolve => setImmediate(resolve))
}

// ── filterLine ────────────────────────────────────────────────────────────────

describe('filterLine', () => {
  it('returns null for empty string', () => {
    expect(filterLine('')).toBeNull()
  })

  it('returns null for whitespace-only', () => {
    expect(filterLine('   ')).toBeNull()
  })

  it('returns plain text unchanged', () => {
    expect(filterLine('Buenas tardes a todos')).toBe('Buenas tardes a todos')
  })

  it('trims surrounding whitespace', () => {
    expect(filterLine('  texto con espacios  ')).toBe('texto con espacios')
  })

  it('strips ANSI escape codes (ESC[2K terminal overwrite)', () => {
    expect(filterLine('\x1b[2KHola mundo')).toBe('Hola mundo')
    expect(filterLine('\r\x1b[2K Francisco Macalla')).toBe('Francisco Macalla')
  })

  it('strips ANSI codes embedded mid-line', () => {
    expect(filterLine('hola \x1b[0mmundo')).toBe('hola mundo')
  })

  it('strips timestamp prefix and returns text', () => {
    expect(filterLine('[00:00:00.000 --> 00:00:02.000]   Hola mundo')).toBe('Hola mundo')
  })

  it('returns null for bracket-only lines', () => {
    expect(filterLine('[BLANK_AUDIO]')).toBeNull()
    expect(filterLine('[MUSIC]')).toBeNull()
    expect(filterLine('[Música]')).toBeNull()
  })

  it('returns null for parenthesis-enclosed lines', () => {
    expect(filterLine('(Música)')).toBeNull()
    expect(filterLine('(Aplausos)')).toBeNull()
    expect(filterLine('(music)')).toBeNull()
  })

  it('returns null for bracket-only lines after stripping timestamp', () => {
    expect(filterLine('[00:00:01.000 --> 00:00:03.000]   [BLANK_AUDIO]')).toBeNull()
    expect(filterLine('[00:00:01.000 --> 00:00:03.000]   (Música)')).toBeNull()
  })
})

// ── createWhisperStream ───────────────────────────────────────────────────────

describe('createWhisperStream', () => {
  it('returns an object with start and stop functions', () => {
    const ws = createWhisperStream('/bin/stream', '/models/base.bin')
    expect(typeof ws.start).toBe('function')
    expect(typeof ws.stop).toBe('function')
  })

  it('spawns the binary with model path and language', () => {
    const proc = makeProcess()
    const mockSpawn = vi.fn().mockReturnValue(proc)
    const ws = createWhisperStream('/bin/stream', '/models/base.bin', mockSpawn)
    ws.start({ language: 'es', onText: () => {} })
    expect(mockSpawn).toHaveBeenCalledWith(
      '/bin/stream',
      expect.arrayContaining(['-m', '/models/base.bin', '-l', 'es']),
      expect.objectContaining({ env: expect.objectContaining({ LD_LIBRARY_PATH: expect.stringContaining('/bin') }) })
    )
  })

  it('defaults to language es when not specified', () => {
    const proc = makeProcess()
    const mockSpawn = vi.fn().mockReturnValue(proc)
    const ws = createWhisperStream('/bin/stream', '/models/base.bin', mockSpawn)
    ws.start({ onText: () => {} })
    expect(mockSpawn).toHaveBeenCalledWith(
      '/bin/stream',
      expect.arrayContaining(['-l', 'es']),
      expect.anything()
    )
  })

  it('calls onText when a newline-terminated line arrives', async () => {
    const proc = makeProcess()
    const mockSpawn = vi.fn().mockReturnValue(proc)
    const onText = vi.fn()
    const ws = createWhisperStream('/bin/stream', '/models/base.bin', mockSpawn)
    ws.start({ language: 'es', onText })
    await push(proc, 'Hola mundo\n')
    expect(onText).toHaveBeenCalledWith('Hola mundo')
  })

  it('calls onText on carriage-return terminated live updates', async () => {
    const proc = makeProcess()
    const mockSpawn = vi.fn().mockReturnValue(proc)
    const onText = vi.fn()
    const ws = createWhisperStream('/bin/stream', '/models/base.bin', mockSpawn)
    ws.start({ language: 'es', onText })
    await push(proc, '\x1b[2K\rHola mundo\r')
    expect(onText).toHaveBeenCalledWith('Hola mundo')
  })

  it('emits only new words from incremental \r updates', async () => {
    const proc = makeProcess()
    const mockSpawn = vi.fn().mockReturnValue(proc)
    const onText = vi.fn()
    const ws = createWhisperStream('/bin/stream', '/models/base.bin', mockSpawn)
    ws.start({ language: 'es', onText })
    // whisper builds up text incrementally: first "Hola", then "Hola como estas"
    await push(proc, '\x1b[2K\rHola\r\x1b[2K\rHola como estas\r')
    const calls = onText.mock.calls.map(c => c[0])
    expect(calls).toContain('Hola')
    expect(calls.some(t => t.includes('como estas'))).toBe(true)
  })

  it('skips empty lines and does not call onText', async () => {
    const proc = makeProcess()
    const mockSpawn = vi.fn().mockReturnValue(proc)
    const onText = vi.fn()
    const ws = createWhisperStream('/bin/stream', '/models/base.bin', mockSpawn)
    ws.start({ language: 'es', onText })
    await push(proc, '\n\n\n')
    expect(onText).not.toHaveBeenCalled()
  })

  it('strips timestamp prefix before calling onText', async () => {
    const proc = makeProcess()
    const mockSpawn = vi.fn().mockReturnValue(proc)
    const onText = vi.fn()
    const ws = createWhisperStream('/bin/stream', '/models/base.bin', mockSpawn)
    ws.start({ language: 'es', onText })
    await push(proc, '[00:00:01.000 --> 00:00:03.000]   Buenas noches\n')
    expect(onText).toHaveBeenCalledWith('Buenas noches')
  })

  it('skips bracket-only lines like [BLANK_AUDIO]', async () => {
    const proc = makeProcess()
    const mockSpawn = vi.fn().mockReturnValue(proc)
    const onText = vi.fn()
    const ws = createWhisperStream('/bin/stream', '/models/base.bin', mockSpawn)
    ws.start({ language: 'es', onText })
    await push(proc, '[BLANK_AUDIO]\n')
    expect(onText).not.toHaveBeenCalled()
  })

  it('calls onError when the process emits an error event', () => {
    const proc = makeProcess()
    const mockSpawn = vi.fn().mockReturnValue(proc)
    const onError = vi.fn()
    const ws = createWhisperStream('/bin/stream', '/models/base.bin', mockSpawn)
    ws.start({ language: 'es', onText: () => {}, onError })
    proc.emit('error', new Error('spawn failed'))
    expect(onError).toHaveBeenCalledWith(expect.any(Error))
  })

  it('calls onError when the process exits with non-zero code', () => {
    const proc = makeProcess()
    const mockSpawn = vi.fn().mockReturnValue(proc)
    const onError = vi.fn()
    const ws = createWhisperStream('/bin/stream', '/models/base.bin', mockSpawn)
    ws.start({ language: 'es', onText: () => {}, onError })
    proc.emit('close', 1)
    expect(onError).toHaveBeenCalled()
  })

  it('does not call onError when process exits with code 0', () => {
    const proc = makeProcess()
    const mockSpawn = vi.fn().mockReturnValue(proc)
    const onError = vi.fn()
    const ws = createWhisperStream('/bin/stream', '/models/base.bin', mockSpawn)
    ws.start({ language: 'es', onText: () => {}, onError })
    proc.emit('close', 0)
    expect(onError).not.toHaveBeenCalled()
  })

  it('stop() kills the process with SIGTERM', () => {
    const proc = makeProcess()
    const mockSpawn = vi.fn().mockReturnValue(proc)
    const ws = createWhisperStream('/bin/stream', '/models/base.bin', mockSpawn)
    ws.start({ language: 'es', onText: () => {} })
    ws.stop()
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('stop() is safe to call before start()', () => {
    const ws = createWhisperStream('/bin/stream', '/models/base.bin')
    expect(() => ws.stop()).not.toThrow()
  })

  it('stop() is safe to call twice', () => {
    const proc = makeProcess()
    const mockSpawn = vi.fn().mockReturnValue(proc)
    const ws = createWhisperStream('/bin/stream', '/models/base.bin', mockSpawn)
    ws.start({ language: 'es', onText: () => {} })
    ws.stop()
    expect(() => ws.stop()).not.toThrow()
  })

  it('stop() clears the proc reference so subsequent start() spawns fresh', () => {
    const proc1 = makeProcess()
    const proc2 = makeProcess()
    let callCount = 0
    const mockSpawn = vi.fn().mockImplementation(() => callCount++ === 0 ? proc1 : proc2)
    const ws = createWhisperStream('/bin/stream', '/models/base.bin', mockSpawn)
    ws.start({ language: 'es', onText: () => {} })
    ws.stop()
    ws.start({ language: 'es', onText: () => {} })
    expect(mockSpawn).toHaveBeenCalledTimes(2)
  })
})