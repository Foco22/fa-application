import { state } from './state.js'
import { loadSavedHighlights } from './highlights.js'
import { stepPdfScale, formatPdfZoom, PDF_BASE_SCALE } from './pdf-zoom.js'

export async function loadPdf() {
  if (!state.activePaper) return
  const viewer      = document.getElementById('pdf-viewer')
  const placeholder = document.getElementById('pdf-placeholder')

  const url = await window.api.getPdfUrl(state.activePaper.id)
  if (!url) {
    viewer.classList.add('hidden')
    placeholder.classList.remove('hidden')
    return
  }

  viewer.innerHTML = ''
  viewer.classList.remove('hidden')
  placeholder.classList.add('hidden')

  const loadId = ++state.pdfLoadId
  try {
    const loadingTask = pdfjsLib.getDocument(url)
    state.pdfDoc = await loadingTask.promise
    if (loadId !== state.pdfLoadId) return

    await renderAllPages(viewer, loadId)
  } catch (err) {
    if (loadId !== state.pdfLoadId) return
    viewer.classList.add('hidden')
    placeholder.classList.remove('hidden')
    console.error('PDF load error:', err)
  }
}

async function renderAllPages(viewer, loadId) {
  for (let i = 1; i <= state.pdfDoc.numPages; i++) {
    if (loadId !== state.pdfLoadId) return
    await renderPdfPage(i, viewer)
  }
  if (loadId !== state.pdfLoadId) return
  loadSavedHighlights()
  updateZoomLabel()
}

/* ── Zoom ──────────────────────────────────────────────────────────────── */

function updateZoomLabel() {
  const el = document.getElementById('pdf-zoom-level')
  if (el) el.textContent = formatPdfZoom(state.pdfScale)
}

// Re-renderiza el documento ya cargado a la nueva escala, conservando la
// posición de scroll proporcional. Usa pdfLoadId para cancelar un render en
// curso si el usuario vuelve a hacer zoom (o cambia de paper) antes de terminar.
export async function setPdfScale(scale) {
  if (scale === state.pdfScale) return
  state.pdfScale = scale
  updateZoomLabel()
  if (!state.pdfDoc) return

  const viewer = document.getElementById('pdf-viewer')
  const ratio  = viewer.scrollHeight > 0 ? viewer.scrollTop / viewer.scrollHeight : 0

  const loadId = ++state.pdfLoadId
  viewer.innerHTML = ''
  try {
    await renderAllPages(viewer, loadId)
  } catch (err) {
    if (loadId !== state.pdfLoadId) return
    console.error('PDF zoom render error:', err)
  }
  if (loadId !== state.pdfLoadId) return
  viewer.scrollTop = ratio * viewer.scrollHeight
}

export function zoomPdf(direction) {
  return setPdfScale(stepPdfScale(state.pdfScale, direction))
}

export function resetPdfZoom() {
  return setPdfScale(PDF_BASE_SCALE)
}

export function setupPdfZoom() {
  document.getElementById('pdf-zoom-in') .addEventListener('click', () => zoomPdf(+1))
  document.getElementById('pdf-zoom-out').addEventListener('click', () => zoomPdf(-1))
  document.getElementById('pdf-zoom-level').addEventListener('click', resetPdfZoom)

  // Ctrl + rueda sobre el PDF hace zoom del documento (no de la interfaz —
  // el handler global de app.js ignora el panel de lectura a propósito).
  document.getElementById('pdf-viewer').addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return
    e.preventDefault()
    zoomPdf(e.deltaY < 0 ? +1 : -1)
  }, { passive: false })
  updateZoomLabel()
}

export async function renderPdfPage(pageNum, container) {
  const page     = await state.pdfDoc.getPage(pageNum)
  const viewport = page.getViewport({ scale: state.pdfScale })

  const pageDiv = document.createElement('div')
  pageDiv.className = 'pdf-page'
  pageDiv.style.width  = viewport.width  + 'px'
  pageDiv.style.height = viewport.height + 'px'

  const canvas    = document.createElement('canvas')
  canvas.width    = viewport.width
  canvas.height   = viewport.height
  pageDiv.appendChild(canvas)

  const textDiv = document.createElement('div')
  textDiv.className = 'textLayer'
  pageDiv.appendChild(textDiv)

  container.appendChild(pageDiv)

  const ctx = canvas.getContext('2d')
  await page.render({ canvasContext: ctx, viewport }).promise

  const textContent = await page.getTextContent()
  const renderTask  = pdfjsLib.renderTextLayer({ textContentSource: textContent, container: textDiv, viewport, textDivs: [] })
  await renderTask.promise
}
