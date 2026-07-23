function registerSettingsHandlers({ ipcMain, db, deps = {} }) {
  ipcMain.handle('get-settings', () => db.getAllSettings())

  ipcMain.handle('get-app-version', () => deps.getAppVersion())

  ipcMain.handle('save-settings', (_e, payload) => {
    for (const [key, value] of Object.entries(payload)) {
      db.saveSetting(key, value)
    }
    return { success: true }
  })

  // El gate de "primer arranque" es la presencia de userName, no un flag aparte:
  // así una instalación migrada (onboardingDone viejo en 'true' pero sin nombre
  // guardado) pide el nombre una sola vez sin re-pedir el resto de la config
  // (ver features/first-run-profile.md, migración).
  ipcMain.handle('check-onboarding', () => !!db.getSetting('userName'))

  ipcMain.handle('complete-onboarding', async (_e, { userName }) => {
    db.saveSetting('userName', userName)
    return { success: true }
  })
}

module.exports = { registerSettingsHandlers }
