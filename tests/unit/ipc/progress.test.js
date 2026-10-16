import { describe, it, expect, vi } from 'vitest'
import { createProgressEmitter } from '../../../src/ipc/progress.js'

function makeWindow() {
  return { webContents: { send: vi.fn() } }
}

describe('createProgressEmitter', () => {
  it('sends a fetch-progress event with stage, current and total', () => {
    const win = makeWindow()
    const emit = createProgressEmitter(win)

    emit('arxiv', 100, 4332)

    expect(win.webContents.send).toHaveBeenCalledWith('fetch-progress', { stage: 'arxiv', current: 100, total: 4332 })
  })

  // Un embedding por texto puede disparar miles de eventos: se limitan para no
  // saturar el canal IPC con repintados que el ojo no distingue.
  it('throttles bursts of events within the same stage', () => {
    const win = makeWindow()
    let t = 0
    const emit = createProgressEmitter(win, () => t, 100)

    emit('embedding', 1, 1000); t = 10
    emit('embedding', 2, 1000); t = 20
    emit('embedding', 3, 1000)

    expect(win.webContents.send).toHaveBeenCalledTimes(1)
  })

  it('sends again once the minimum interval has passed', () => {
    const win = makeWindow()
    let t = 0
    const emit = createProgressEmitter(win, () => t, 100)

    emit('embedding', 1, 1000); t = 150
    emit('embedding', 2, 1000)

    expect(win.webContents.send).toHaveBeenCalledTimes(2)
  })

  it('always sends the first event of a new stage and the final event (current === total)', () => {
    const win = makeWindow()
    let t = 0
    const emit = createProgressEmitter(win, () => t, 100)

    emit('embedding', 1, 10); t = 1
    emit('embedding', 10, 10); t = 2          // final → always
    emit('rerank', 0, 5)                       // new stage → always

    expect(win.webContents.send.mock.calls.map(c => c[1])).toEqual([
      { stage: 'embedding', current: 1, total: 10 },
      { stage: 'embedding', current: 10, total: 10 },
      { stage: 'rerank', current: 0, total: 5 },
    ])
  })

  it('never throws when there is no window', () => {
    expect(() => createProgressEmitter(null)('arxiv', 1, 2)).not.toThrow()
  })
})
