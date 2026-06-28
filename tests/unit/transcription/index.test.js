import { describe, it, expect, vi } from 'vitest'
import { createTranscription } from '../../../src/transcription/index.js'

function makeClient(overrides = {}) {
  return {
    audio: {
      transcriptions: {
        create: vi.fn().mockResolvedValue({ text: 'texto transcrito' }),
        ...overrides
      }
    }
  }
}

describe('createTranscription', () => {
  it('returns an object with a transcribe function', () => {
    const t = createTranscription('sk-test', {}, makeClient())
    expect(typeof t.transcribe).toBe('function')
  })

  it('uses gpt-4o-mini-transcribe as default model', async () => {
    const mockCreate = vi.fn().mockResolvedValue({ text: 'hola mundo' })
    const client = { audio: { transcriptions: { create: mockCreate } } }

    const t = createTranscription('sk-test', {}, client)
    await t.transcribe(Array.from(Buffer.from('fake-audio')), 'audio/webm;codecs=opus')

    const call = mockCreate.mock.calls[0][0]
    expect(call.model).toBe('gpt-4o-mini-transcribe')
    expect(call.language).toBeUndefined()
    expect(call.file.type).toBe('audio/webm;codecs=opus')
  })

  it('uses model from options when provided', async () => {
    const mockCreate = vi.fn().mockResolvedValue({ text: 'hola' })
    const client = { audio: { transcriptions: { create: mockCreate } } }
    const t = createTranscription('sk-test', { model: 'gpt-4o-transcribe' }, client)
    await t.transcribe([1, 2, 3])
    expect(mockCreate.mock.calls[0][0].model).toBe('gpt-4o-transcribe')
  })

  it('passes language to the API when provided', async () => {
    const mockCreate = vi.fn().mockResolvedValue({ text: 'hola' })
    const client = { audio: { transcriptions: { create: mockCreate } } }
    const t = createTranscription('sk-test', {}, client)
    await t.transcribe([1, 2, 3], 'audio/webm', 'es')
    expect(mockCreate.mock.calls[0][0].language).toBe('es')
  })

  it('omits language param when not provided', async () => {
    const mockCreate = vi.fn().mockResolvedValue({ text: 'hello' })
    const client = { audio: { transcriptions: { create: mockCreate } } }
    const t = createTranscription('sk-test', {}, client)
    await t.transcribe([1, 2, 3])
    expect(mockCreate.mock.calls[0][0].language).toBeUndefined()
  })

  it('uses audio/webm as default mimeType', async () => {
    const mockCreate = vi.fn().mockResolvedValue({ text: 'test' })
    const client = { audio: { transcriptions: { create: mockCreate } } }
    const t = createTranscription('sk-test', {}, client)
    await t.transcribe([1, 2, 3])
    expect(mockCreate.mock.calls[0][0].file.type).toBe('audio/webm')
  })

  it('returns { text } from the API response', async () => {
    const client = makeClient({ create: vi.fn().mockResolvedValue({ text: 'respuesta exacta' }) })
    const t = createTranscription('sk-test', {}, client)
    const result = await t.transcribe([1, 2, 3])
    expect(result).toEqual({ text: 'respuesta exacta' })
  })

  it('propagates errors thrown by the API client', async () => {
    const mockCreate = vi.fn().mockRejectedValue(new Error('API error'))
    const client = { audio: { transcriptions: { create: mockCreate } } }
    const t = createTranscription('sk-test', {}, client)
    await expect(t.transcribe([1, 2, 3])).rejects.toThrow('API error')
  })
})
