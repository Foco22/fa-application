function registerSettingsHandlers({ ipcMain, db, deps = {} }) {
  ipcMain.handle('get-settings', () => db.getAllSettings())

  ipcMain.handle('get-app-version', () => deps.getAppVersion())

  ipcMain.handle('save-settings', (_e, payload) => {
    for (const [key, value] of Object.entries(payload)) {
      db.saveSetting(key, value)
    }
    return { success: true }
  })

  ipcMain.handle('check-onboarding', () => db.getSetting('onboardingDone') === 'true')

  ipcMain.handle('complete-onboarding', async (_e, settings) => {
    for (const [key, value] of Object.entries(settings)) {
      db.saveSetting(key, value)
    }
    db.saveSetting('onboardingDone', 'true')
    return { success: true }
  })
}

module.exports = { registerSettingsHandlers }
