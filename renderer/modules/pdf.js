import { state } from './state.js'
import { loadSavedHighlights } from './highlights.js'

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

    for (let i = 1; i <= state.pdfDoc.numPages; i++) {
      if (loadId !== state.pdfLoadId) return
      await renderPdfPage(i, viewer)
    }
    loadSavedHighlights()
  } catch (err) {
    if (loadId !== state.pdfLoadId) return
    viewer.classList.add('hidden')
    placeholder.classList.remove('hidden')
    console.error('PDF load error:', err)
  }
}

export async function renderPdfPage(pageNum, container) {
  const page     = await state.pdfDoc.getPage(pageNum)
  const scale    = 1.5
  const viewport = page.getViewport({ scale })

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
