const fs = require('fs')
const { resolveOcrConfig } = require('../ingestion/ocr-config')

function registerLearningHandlers({ ipcMain, db, deps, mainWindow }) {
  const {
    createLLM, chatWithPaper, vault,
    rasterizePdf, transcribePdfToMarkdown, pdfParse, extractPagesText,
    parsePdfWithLlamaParse, httpClient,
    OCR_MAX_CHARS = 200000,
  } = deps

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
    return chatWithPaper(message, paper, history || [], llm, settings.language)
  })

  // OCR bajo demanda — ÚNICO punto de entrada al OCR. Solo sobre un paper que YA
  // existe en la DB y tiene su PDF en raw/. Nunca lo dispara runFetch /
  // index-files / indexReferenceFolder. Funciona igual para papers de fetch y de
  // referencia (ref-…). Aplica también a re-corridas (sobrescribe).
  ipcMain.handle('generate-ocr', async (_e, { paperId } = {}) => {
    const paper = db.getPaper(paperId)
    if (!paper) return { success: false, error: 'not-found' }

    const settings = db.getAllSettings()
    // Motor de OCR elegido en la pestaña OCR. LlamaParse (gratis hasta 10k créditos/mes)
    // no usa el modelo de visión del LLM, así que tampoco exige que lo tenga.
    const ocr = resolveOcrConfig(settings)
    const useLlamaParse = ocr.engine === 'llamaparse'
    if (useLlamaParse && !ocr.llamaParse.apiKey) return { success: false, error: 'no-llamaparse-key' }

    const llm = useLlamaParse ? null : createLLM(ocr.visionSettings)
    // Mismo guard que src/ipc/class.js para proveedores sin visión (DeepSeek):
    // degradar sin bloquear ni tocar el pdf_text existente.
    if (llm && !llm.transcribePageToMarkdown) return { success: false, error: 'no-vision' }

    const pdfFile = vault.pdfPath(paper)
    if (!pdfFile || !fs.existsSync(pdfFile)) return { success: false, error: 'no-pdf' }
    const buffer = fs.readFileSync(pdfFile)

    let result
    try {
      // Si LlamaParse falla NO se cae al OCR de visión: eso gastaría tokens del LLM
      // sin que el usuario lo haya decidido. Se informa el error y se deja elegir.
      result = useLlamaParse
        ? { fallbackUsed: false, ...await parsePdfWithLlamaParse(buffer, { apiKey: ocr.llamaParse.apiKey, tier: ocr.llamaParse.tier, httpClient }) }
        : await transcribePdfToMarkdown(buffer, {
            rasterizePdf, llm, pdfParse, extractPagesText,
            onProgress: (page, total) => mainWindow?.webContents.send('ocr-progress', { paperId, page, total }),
          })
    } catch (err) {
      result = { success: false, error: err.message }
    }

    if (!result.success) {
      // Fallo total: NO tocar el pdf_text existente; solo registrar ocr_error.
      db.savePaper({ ...paper, ocr_error: result.error })
      mainWindow?.webContents.send('ocr-error', { paperId, error: result.error })
      return { success: false, error: result.error }
    }

    // El techo de 30K de pdf-parse NO aplica al OCR: solo un tope alto de fila SQLite.
    const markdown = (result.markdown || '').slice(0, OCR_MAX_CHARS)
    try { vault.writeOcr(paper, markdown) } catch (_) {}
    const ocrError = result.fallbackUsed
      ? 'Algunas páginas cayeron a pdf-parse como fallback — revisá la transcripción.'
      : null
    db.savePaper({ ...paper, pdf_text: markdown, pdf_text_source: 'ocr', ocr_error: ocrError })
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
