// Núcleo del OCR de un paper, compartido por el botón OCR (`generate-ocr`) y por el
// fetch semanal, que lo corre solo sobre los papers recién guardados.
const { resolveOcrConfig } = require('./ocr-config')

// Decide con qué motor se hace el OCR. Devuelve { error } si no es posible
// ('no-llamaparse-key' | 'no-vision'); de lo contrario { useLlamaParse, ocr, llm }.
function resolveOcrEngine(settings, createLLM) {
  const ocr = resolveOcrConfig(settings)
  const useLlamaParse = ocr.engine === 'llamaparse'
  if (useLlamaParse && !ocr.llamaParse.apiKey) return { error: 'no-llamaparse-key' }

  // LlamaParse no usa el modelo de visión del LLM, así que tampoco exige que lo tenga.
  const llm = useLlamaParse ? null : createLLM(ocr.visionSettings)
  // Proveedores sin visión (DeepSeek): degradar sin tocar el pdf_text existente.
  if (llm && !llm.transcribePageToMarkdown) return { error: 'no-vision' }

  return { useLlamaParse, ocr, llm }
}

// Hace el OCR del PDF ya leído en memoria y persiste el resultado (DB + vault).
// Nunca lanza: devuelve { success:false, error }. En fallo NO toca el pdf_text
// existente (solo registra ocr_error) y NO cae a otro motor: caer de LlamaParse al
// OCR de visión gastaría tokens del LLM sin que el usuario lo haya decidido.
async function runOcrOnBuffer({ paper, buffer, engine, db, deps, onProgress = null }) {
  const {
    vault, httpClient, parsePdfWithLlamaParse, transcribePdfToMarkdown,
    rasterizePdf, pdfParse, extractPagesText, OCR_MAX_CHARS = 200000,
  } = deps

  let result
  try {
    result = engine.useLlamaParse
      ? { fallbackUsed: false, ...await parsePdfWithLlamaParse(buffer, { apiKey: engine.ocr.llamaParse.apiKey, tier: engine.ocr.llamaParse.tier, httpClient }) }
      : await transcribePdfToMarkdown(buffer, { rasterizePdf, llm: engine.llm, pdfParse, extractPagesText, onProgress })
  } catch (err) {
    result = { success: false, error: err.message }
  }

  if (!result.success) {
    db.savePaper({ ...paper, ocr_error: result.error })
    return { success: false, error: result.error }
  }

  // El techo de 30K de pdf-parse NO aplica al OCR: solo un tope alto de fila SQLite.
  const markdown = (result.markdown || '').slice(0, OCR_MAX_CHARS)
  try { vault.writeOcr(paper, markdown) } catch (_) {}
  const ocrError = result.fallbackUsed
    ? 'Algunas páginas cayeron a pdf-parse como fallback — revisá la transcripción.'
    : null
  const updated = { ...paper, pdf_text: markdown, pdf_text_source: 'ocr', ocr_error: ocrError }
  db.savePaper(updated)
  return { success: true, pageCount: result.pageCount, fallbackUsed: result.fallbackUsed, paper: updated }
}

module.exports = { resolveOcrEngine, runOcrOnBuffer }
