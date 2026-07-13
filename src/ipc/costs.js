const { getCostSummary } = require('../costs')
const { refreshPricingIfStale, saveManualOverride } = require('../pricing')

function registerCostsHandlers({ ipcMain, db, deps }) {
  const { httpClient } = deps

  ipcMain.handle('get-cost-summary', (_e, { groupBy = 'week', from = null, to = null } = {}) =>
    getCostSummary(db, { groupBy, from, to })
  )

  // Qué tan confiable es lo que muestra el dashboard: cuándo se actualizó la
  // tabla por última vez y cuántos precios corrigió el usuario a mano.
  ipcMain.handle('get-pricing-status', () => {
    const rows = db.getPricingRows()
    return {
      lastFetched: db.getSetting('pricingLastFetched') || null,
      models:      rows.length,
      overrides:   rows.filter(r => r.source === 'manual').length,
      rows,
    }
  })

  ipcMain.handle('refresh-pricing', async () => {
    const res = await refreshPricingIfStale(db, httpClient, { force: true })
    return { ...res, lastFetched: db.getSetting('pricingLastFetched') || null }
  })

  ipcMain.handle('save-pricing-override', (_e, { provider, model, prices }) => {
    saveManualOverride(db, provider, model, prices)
    return db.getPricingRow(provider, model)
  })
}

module.exports = { registerCostsHandlers }
