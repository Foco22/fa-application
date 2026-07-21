import { describe, it, expect, vi } from 'vitest'
import { registerSettingsHandlers } from '../../../src/ipc/settings.js'

function makeIpcMain() {
  const handlers = {}
  return {
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn } },
    invoke:  (ch, ...args) => handlers[ch]({}, ...args),
    handlers,
  }
}

function makeDb(overrides = {}) {
  return {
    getAllSettings: vi.fn().mockReturnValue({}),
    getSetting:     vi.fn(),
    saveSetting:    vi.fn(),
    ...overrides
  }
}

describe('get-settings / save-settings / onboarding (existing contract unchanged)', () => {
  it('get-settings returns db.getAllSettings()', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const db = makeDb({ getAllSettings: vi.fn().mockReturnValue({ apiKey: 'sk-1' }) })
    registerSettingsHandlers({ ipcMain, db, deps: {} })
    expect(await invoke('get-settings')).toEqual({ apiKey: 'sk-1' })
  })

  it('save-settings persists every key in the payload', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const db = makeDb()
    registerSettingsHandlers({ ipcMain, db, deps: {} })
    await invoke('save-settings', { language: 'en', embeddingApiKey: 'sk-emb' })
    expect(db.saveSetting).toHaveBeenCalledWith('language', 'en')
    expect(db.saveSetting).toHaveBeenCalledWith('embeddingApiKey', 'sk-emb')
  })
})

describe('get-app-version', () => {
  it('returns the version from deps.getAppVersion()', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const db = makeDb()
    const deps = { getAppVersion: vi.fn().mockReturnValue('1.4.0') }
    registerSettingsHandlers({ ipcMain, db, deps })
    expect(await invoke('get-app-version')).toBe('1.4.0')
    expect(deps.getAppVersion).toHaveBeenCalled()
  })
})
