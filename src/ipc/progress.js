// Emite 'fetch-progress' al renderer para la barra del botón Fetch.
//
// Un embedding por texto o un score de rerank por documento pueden disparar
// miles de eventos; se limitan a uno cada `minIntervalMs` por etapa. Siempre pasan
// el primer evento de cada etapa y el final (current === total), para que la
// barra nunca se quede a medias.
function createProgressEmitter(mainWindow, now = Date.now, minIntervalMs = 100) {
  let lastStage = null
  let lastSentAt = -Infinity

  return function emit(stage, current, total) {
    if (!mainWindow) return
    const t = now()
    const isFirstOfStage = stage !== lastStage
    const isFinal = current === total
    if (!isFirstOfStage && !isFinal && t - lastSentAt < minIntervalMs) return

    lastStage = stage
    lastSentAt = t
    mainWindow.webContents.send('fetch-progress', { stage, current, total })
  }
}

module.exports = { createProgressEmitter }
