import { state } from './state.js'
import { loadSavedHighlights } from './highlights.js'
import { formatPdfZoom, createZoomDebouncer } from './pdf-zoom.js'

// Tareas de render en vuelo: se cancelan al iniciar un render nuevo.
const activeTasks = new Set()

function cancelActiveRenders() {
  for (const task of activeTasks) task.cancel()
  activeTasks.clear()
}

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
    await renderPdfPage(i, viewer, loadId)
  }
  if (loadId !== state.pdfLoadId) return
  loadSavedHighlights()
  updateZoomLabel()
}

/* ── Zoom ──────────────────────────────────────────────────────────────── */

function updateZoomLabel(scale = state.pdfScale) {
  const el = document.getElementById('pdf-zoom-level')
  if (el) el.textContent = formatPdfZoom(scale)
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
  cancelActiveRenders()
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

// Los pasos de zoom se agrupan (120 ms): una ráfaga de eventos de rueda
// re-renderiza el documento una sola vez en vez de una por evento.
const zoomer = createZoomDebouncer({
  getScale:  () => state.pdfScale,
  apply:     setPdfScale,
  onPreview: updateZoomLabel
})

export function zoomPdf(direction) { zoomer.step(direction) }

export function resetPdfZoom() { zoomer.reset() }

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

export async function renderPdfPage(pageNum, container, loadId = state.pdfLoadId) {
  const page = await state.pdfDoc.getPage(pageNum)
  if (loadId !== state.pdfLoadId) return   // un zoom o cambio de paper la dejó obsoleta

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
  const task = page.render({ canvasContext: ctx, viewport })
  activeTasks.add(task)
  try {
    await task.promise
    if (loadId !== state.pdfLoadId) return

    const textContent = await page.getTextContent()
    if (loadId !== state.pdfLoadId) return
    const textTask = pdfjsLib.renderTextLayer({ textContentSource: textContent, container: textDiv, viewport, textDivs: [] })
    activeTasks.add(textTask)
    try { await textTask.promise } finally { activeTasks.delete(textTask) }
  } catch (err) {
    // Cancelar un render obsoleto lanza RenderingCancelledException: es esperado.
    if (loadId !== state.pdfLoadId) return
    throw err
  } finally {
    activeTasks.delete(task)
  }
}
