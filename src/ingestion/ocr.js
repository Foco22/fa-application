// Orquestador de OCR del documento completo.
//
// Recorre las páginas rasterizadas en orden, pide a `llm.transcribePageToMarkdown`
// la transcripción fiel de cada una, y concatena el resultado con un separador
// que identifica la página y su fuente. NO lo llaman runFetch / index-files /
// indexReferenceFolder: es una acción explícita del usuario (IPC generate-ocr).
//
// Garantías de diseño (§4 del PRD):
//  - Fallo por página NO aborta la corrida: cae al texto de pdf-parse de esa
//    página como fallback local, marcado explícitamente en el Markdown.
//  - Nunca inventa: si ni la visión ni pdf-parse dieron texto, marca [ilegible].
//  - Fallo total (sin visión / sin rasterizador / rasterización falla) devuelve
//    { success:false } sin lanzar, para que el caller no toque el pdf_text previo.

const { extractPagesText: defaultExtractPagesText } = require('./extractor')

async function transcribePdfToMarkdown(buffer, {
  rasterizePdf,
  llm,
  pdfParse,
  extractPagesText = defaultExtractPagesText,
  onProgress,
} = {}) {
  if (!llm || typeof llm.transcribePageToMarkdown !== 'function') {
    return { success: false, error: 'no-vision', markdown: null }
  }
  if (typeof rasterizePdf !== 'function') {
    return { success: false, error: 'no-rasterizer', markdown: null }
  }

  let pages
  try {
    pages = await rasterizePdf(buffer)
  } catch (err) {
    return { success: false, error: err.message, markdown: null }
  }
  if (!Array.isArray(pages) || pages.length === 0) {
    return { success: false, error: 'no-pages', markdown: null }
  }

  // Texto de pdf-parse por página (una sola pasada), best-effort: solo se usa
  // como fallback si la visión de esa página falla.
  let fallbackPages = []
  try {
    const res = await extractPagesText(buffer, pdfParse)
    if (res && res.success) fallbackPages = res.pages || []
  } catch (_) { /* fallback opcional */ }

  const parts = []
  let fallbackUsed = false

  for (let i = 0; i < pages.length; i++) {
    const pageNum = i + 1
    if (onProgress) onProgress(pageNum, pages.length)
    const { base64, mimeType } = pages[i]

    try {
      const md = await llm.transcribePageToMarkdown(base64, mimeType)
      parts.push(`<!-- page ${pageNum} · source: ocr -->\n${md}`)

      // Interpretación profunda de figuras: corre siempre que el proveedor la
      // soporte, como parte por defecto del OCR — no es un paso opt-in. Se
      // anota como bloque de cita aparte, nunca mezclada con el texto de la página.
      if (typeof llm.interpretFigureInDepth === 'function') {
        try {
          const fig = await llm.interpretFigureInDepth(base64, mimeType)
          if (fig && fig.trim()) {
            parts.push(`<!-- page ${pageNum} · figures -->\n> ${fig.trim().replace(/\n/g, '\n> ')}`)
          }
        } catch (_) { /* la figura es opcional: su fallo no rompe el OCR */ }
      }
    } catch (err) {
      fallbackUsed = true
      const fb = (fallbackPages[i] && fallbackPages[i].trim()) ? fallbackPages[i] : '[ilegible]'
      parts.push(`<!-- page ${pageNum} · source: pdf-parse fallback (vision error: ${err.message}) -->\n${fb}`)
    }
  }

  return {
    success: true,
    markdown: parts.join('\n\n'),
    pageCount: pages.length,
    fallbackUsed,
  }
}

module.exports = { transcribePdfToMarkdown }
