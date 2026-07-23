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

describe('check-onboarding (gate = presencia de userName, no un flag aparte)', () => {
  it('returns true when userName is set', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const db = makeDb({ getSetting: vi.fn().mockReturnValue('Francisco') })
    registerSettingsHandlers({ ipcMain, db, deps: {} })
    expect(await invoke('check-onboarding')).toBe(true)
    expect(db.getSetting).toHaveBeenCalledWith('userName')
  })

  it('returns false when userName is not set', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const db = makeDb({ getSetting: vi.fn().mockReturnValue(undefined) })
    registerSettingsHandlers({ ipcMain, db, deps: {} })
    expect(await invoke('check-onboarding')).toBe(false)
  })

  it('returns false when userName is an empty string', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const db = makeDb({ getSetting: vi.fn().mockReturnValue('') })
    registerSettingsHandlers({ ipcMain, db, deps: {} })
    expect(await invoke('check-onboarding')).toBe(false)
  })

  // Instalación migrada: onboardingDone (flag viejo) ya no es lo que se lee.
  it('ignores onboardingDone entirely — solo mira userName', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const stored = { onboardingDone: 'true' }
    const db = makeDb({ getSetting: vi.fn((key) => stored[key]) })
    registerSettingsHandlers({ ipcMain, db, deps: {} })
    expect(await invoke('check-onboarding')).toBe(false)
  })
})

describe('complete-onboarding', () => {
  it('saves only userName, nada más', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const db = makeDb()
    registerSettingsHandlers({ ipcMain, db, deps: {} })
    await invoke('complete-onboarding', { userName: 'Francisco' })
    expect(db.saveSetting).toHaveBeenCalledWith('userName', 'Francisco')
    expect(db.saveSetting).toHaveBeenCalledOnce()
  })

  it('returns { success: true }', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const db = makeDb()
    registerSettingsHandlers({ ipcMain, db, deps: {} })
    expect(await invoke('complete-onboarding', { userName: 'Francisco' })).toEqual({ success: true })
  })
})
