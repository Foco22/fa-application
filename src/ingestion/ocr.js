// Orquestador de OCR del documento completo.
//
// Rasteriza el PDF y pide a `llm.transcribePageToMarkdown` la transcripción
// fiel de cada página, con hasta `concurrency` páginas en vuelo a la vez (cada
// página es una llamada independiente a la API, así que no hay razón para
// esperarlas una por una — en un paper de 20 páginas eso es 20x la latencia
// de una sola llamada). El resultado se concatena en orden de página, no en
// orden de finalización. NO lo llaman runFetch / index-files /
// indexReferenceFolder: es una acción explícita del usuario (IPC generate-ocr).
//
// Garantías de diseño (§4 del PRD):
//  - Fallo por página NO aborta la corrida: cae al texto de pdf-parse de esa
//    página como fallback local, marcado explícitamente en el Markdown.
//  - Nunca inventa: si ni la visión ni pdf-parse dieron texto, marca [ilegible].
//  - Fallo total (sin visión / sin rasterizador / rasterización falla) devuelve
//    { success:false } sin lanzar, para que el caller no toque el pdf_text previo.

const { extractPagesText: defaultExtractPagesText } = require('./extractor')

const DEFAULT_CONCURRENCY = 4

// Los modelos de visión suelen envolver TODA la respuesta en un fence
// ```markdown ... ``` aunque el prompt pida solo el Markdown de la página —
// el mismo hábito que parseJSONResponse ya maneja para JSON (src/llm/prompts.js).
// Solo saca el fence si envuelve la respuesta entera (ancla a inicio/fin), así
// un bloque de código legítimo dentro de la transcripción (ej. pseudocódigo)
// queda intacto.
function stripWrappingFence(text) {
  return (text || '').trim()
    .replace(/^```[a-z]*\s*\n?/i, '').replace(/\n?```$/, '').trim()
}

async function transcribePdfToMarkdown(buffer, {
  rasterizePdf,
  llm,
  pdfParse,
  extractPagesText = defaultExtractPagesText,
  onProgress,
  concurrency = DEFAULT_CONCURRENCY,
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

  // pageParts[i] guarda los bloques de markdown de esa página (texto + figuras
  // opcionales), indexado por página para poder concatenar en orden al final
  // aunque las páginas terminen en cualquier orden.
  const pageParts = new Array(pages.length)
  let fallbackUsed = false
  let completed = 0

  async function processPage(i) {
    const pageNum = i + 1
    const { base64, mimeType } = pages[i]
    const parts = []

    try {
      const md = stripWrappingFence(await llm.transcribePageToMarkdown(base64, mimeType))
      parts.push(`<!-- page ${pageNum} · source: ocr -->\n${md}`)

      // Interpretación profunda de figuras: corre siempre que el proveedor la
      // soporte, como parte por defecto del OCR — no es un paso opt-in. Se
      // anota como bloque de cita aparte, nunca mezclada con el texto de la página.
      if (typeof llm.interpretFigureInDepth === 'function') {
        try {
          const fig = stripWrappingFence(await llm.interpretFigureInDepth(base64, mimeType))
          if (fig) {
            parts.push(`<!-- page ${pageNum} · figures -->\n> ${fig.replace(/\n/g, '\n> ')}`)
          }
        } catch (_) { /* la figura es opcional: su fallo no rompe el OCR */ }
      }
    } catch (err) {
      fallbackUsed = true
      const fb = (fallbackPages[i] && fallbackPages[i].trim()) ? fallbackPages[i] : '[ilegible]'
      parts.push(`<!-- page ${pageNum} · source: pdf-parse fallback (vision error: ${err.message}) -->\n${fb}`)
    }

    pageParts[i] = parts
    completed++
    if (onProgress) onProgress(completed, pages.length)
  }

  // Pool de concurrencia acotada: cada worker toma la siguiente página libre
  // hasta que no queden. Sin dependencias nuevas — es un patrón de ~5 líneas.
  let nextIndex = 0
  async function worker() {
    while (nextIndex < pages.length) {
      const i = nextIndex++
      await processPage(i)
    }
  }
  const workerCount = Math.max(1, Math.min(concurrency, pages.length))
  await Promise.all(Array.from({ length: workerCount }, worker))

  return {
    success: true,
    markdown: pageParts.flat().join('\n\n'),
    pageCount: pages.length,
    fallbackUsed,
  }
}

module.exports = { transcribePdfToMarkdown }
