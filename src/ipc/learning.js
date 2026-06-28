function registerLearningHandlers({ ipcMain, db, deps, mainWindow }) {
  const { createLLM, chatWithPaper, vault } = deps

  ipcMain.handle('save-quiz-result', (_e, payload) => {
    db.saveQuizResult(payload)
    return { success: true }
  })

  ipcMain.handle('get-quiz-results', (_e, paperId) => db.getQuizResults(paperId))

  ipcMain.handle('generate-quiz', async (_e, paperId) => {
    const paper    = db.getPaper(paperId)
    const settings = db.getAllSettings()
    const llm      = createLLM(settings)
    const quiz     = await llm.generateQuiz(paper)
    db.savePaper({ ...paper, quiz: JSON.stringify(quiz) })
    try { vault.writeQuiz(paper, quiz) } catch (_) {}
    return quiz
  })

  ipcMain.handle('start-summary', async (_e, paperId) => {
    const paper    = db.getPaper(paperId)
    const settings = db.getAllSettings()
    const llm      = createLLM(settings)
    try {
      const fullText = await llm.streamSummary(paper, (chunk) => {
        mainWindow?.webContents.send('summary-chunk', chunk)
      })
      db.savePaper({ ...paper, summary: fullText })
      try { vault.writeSummary(paper, fullText) } catch (_) {}
      mainWindow?.webContents.send('summary-done')
    } catch (err) {
      mainWindow?.webContents.send('summary-error', err.message)
    }
  })

  ipcMain.handle('chat-message', async (_e, { message, paperId, history }) => {
    const settings = db.getAllSettings()
    const llm      = createLLM(settings)
    const paper    = paperId ? db.getPaper(paperId) : null
    return chatWithPaper(message, paper, history || [], llm)
  })
}

module.exports = { registerLearningHandlers }
