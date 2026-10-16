const fs = require('fs')
const { resolveOcrEngine, runOcrOnBuffer } = require('../ingestion/ocr-runner')
const { hasOcr, OCR_REQUIRED } = require('../ingestion/ocr-gate')

function registerLearningHandlers({ ipcMain, db, deps, mainWindow }) {
  const {
    createLLM, chatWithPaper, vault,
    OCR_MAX_CHARS = 200000,
  } = deps

  ipcMain.handle('save-quiz-result', (_e, payload) => {
    db.saveQuizResult(payload)
    return { success: true }
  })

  ipcMain.handle('get-quiz-results', (_e, paperId) => db.getQuizResults(paperId))

  ipcMain.handle('generate-quiz', async (_e, paperId) => {
    const paper    = db.getPaper(paperId)
    if (!hasOcr(paper)) return { error: OCR_REQUIRED }
    const settings = db.getAllSettings()
    const llm      = createLLM(settings)
    const quiz     = await llm.generateQuiz(paper)
    db.savePaper({ ...paper, quiz: JSON.stringify(quiz) })
    try { vault.writeQuiz(paper, quiz) } catch (_) {}
    return quiz
  })

  ipcMain.handle('start-summary', async (_e, paperId) => {
    const paper    = db.getPaper(paperId)
    if (!hasOcr(paper)) return { error: OCR_REQUIRED }
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
    const paper    = paperId ? db.getPaper(paperId) : null
    // Sin paper (preguntas generales de investigación) el chat no se limita.
    if (paper && !hasOcr(paper)) return { error: OCR_REQUIRED }
    const llm      = createLLM(settings)
    return chatWithPaper(message, paper, history || [], llm, settings.language)
  })

  // OCR bajo demanda desde el botón OCR del paper (también aplica a papers de
  // referencia ref-… y a re-corridas, que sobrescriben). El fetch semanal corre el
  // mismo núcleo (ingestion/ocr-runner) sobre los papers que acaba de guardar.
  ipcMain.handle('generate-ocr', async (_e, { paperId } = {}) => {
    const paper = db.getPaper(paperId)
    if (!paper) return { success: false, error: 'not-found' }

    const engine = resolveOcrEngine(db.getAllSettings(), createLLM)
    if (engine.error) return { success: false, error: engine.error }

    const pdfFile = vault.pdfPath(paper)
    if (!pdfFile || !fs.existsSync(pdfFile)) return { success: false, error: 'no-pdf' }
    const buffer = fs.readFileSync(pdfFile)

    const result = await runOcrOnBuffer({
      paper, buffer, engine, db, deps,
      onProgress: (page, total) => mainWindow?.webContents.send('ocr-progress', { paperId, page, total }),
    })

    if (!result.success) {
      mainWindow?.webContents.send('ocr-error', { paperId, error: result.error })
      return { success: false, error: result.error }
    }
    mainWindow?.webContents.send('ocr-done', { paperId, pageCount: result.pageCount, fallbackUsed: result.fallbackUsed })
    return { success: true, pageCount: result.pageCount, fallbackUsed: result.fallbackUsed }
  })

  // Recarga desde el archivo editado a mano: resincroniza papers.pdf_text con
  // ocr/<id>.md sin volver a pagar ninguna llamada al LLM (OCR-005).
  ipcMain.handle('reload-ocr-from-file', (_e, paperId) => {
    const paper = db.getPaper(paperId)
    if (!paper) return { success: false, error: 'not-found' }
    const markdown = vault.readOcr(paper)
    if (markdown == null) return { success: false, error: 'no-file' }
    db.savePaper({ ...paper, pdf_text: markdown.slice(0, OCR_MAX_CHARS), pdf_text_source: 'ocr' })
    return { success: true }
  })
}

module.exports = { registerLearningHandlers }
