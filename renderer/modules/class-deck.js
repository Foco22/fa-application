// Editor de slides de la Clase: markdown a la izquierda, preview en vivo de la
// slide donde está el cursor a la derecha, y un panel opcional con el PDF (el
// del paper con los destacados de la app, o uno propio abierto desde disco con
// destacados hechos en otro lector) para ir armando las slides desde ahí.
import { t } from './language.js'
import { escAttr } from './utils.js'
import { toast } from './toast.js'
import { rectToScreen } from './pdf-zoom.js'
import {
  splitSlides, slideIndexAtOffset, slideOffset, highlightToMarkdown,
  textUnderQuads, buildStarterDeck, mountSlide
} from './slides-md.js'

const SAVE_DEBOUNCE_MS = 600
const PDF_SCALE_STEP = 0.2
const PDF_SCALE_MIN  = 0.6
const PDF_SCALE_MAX  = 3.0
// Tipos de anotación de un PDF externo que cuentan como "destacado".
const HIGHLIGHT_SUBTYPES = new Set(['Highlight', 'Underline'])

let _paper        = null
let _previewIndex = 0
let _saveTimer    = null
let _onChange     = null

// Estado del panel PDF. source: 'paper' (PDF del paper + destacados de la app)
// o 'file' (PDF elegido desde disco + sus anotaciones Highlight).
let _pdf = { doc: null, source: null, name: '', scale: 1.2, loadId: 0, highlights: [] }

const $ = (id) => document.getElementById(id)
const editor = () => $('class-deck-md')

// ── Público ──────────────────────────────────────────────────────────────────

export function initDeck({ onChange } = {}) {
  _onChange = onChange
  const ta = editor()

  ta.addEventListener('input', () => {
    syncPreviewToCursor()
    scheduleSave()
    _onChange?.()
  })
  ta.addEventListener('click', syncPreviewToCursor)
  ta.addEventListener('keyup', syncPreviewToCursor)
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); insertText('  ') }
  })

  $('class-deck-prev').addEventListener('click', () => goToSlide(_previewIndex - 1))
  $('class-deck-next').addEventListener('click', () => goToSlide(_previewIndex + 1))
  $('class-deck-new-slide').addEventListener('click', insertNewSlide)

  $('class-deck-toggle-pdf').addEventListener('click', togglePdfPanel)
  $('class-deck-pdf-paper').addEventListener('click', loadPaperPdf)
  $('class-deck-pdf-open').addEventListener('click', pickPdf)
  $('class-deck-pdf-zoom-in').addEventListener('click', () => zoomPdf(+1))
  $('class-deck-pdf-zoom-out').addEventListener('click', () => zoomPdf(-1))

  // Selección de texto en el PDF → botón flotante "Insertar en la slide"
  const pages = $('class-deck-pdf-pages')
  const insertBtn = $('class-deck-insert-selection')
  pages.addEventListener('mouseup', () => setTimeout(showInsertSelectionButton, 10))
  pages.addEventListener('scroll', () => insertBtn.classList.add('hidden'))
  // mousedown con preventDefault: el click no debe borrar la selección antes de leerla
  insertBtn.addEventListener('mousedown', (e) => e.preventDefault())
  insertBtn.addEventListener('click', () => {
    const text = window.getSelection()?.toString().trim()
    insertBtn.classList.add('hidden')
    if (!text) return
    insertFromPdf(highlightToMarkdown({ text }))
    window.getSelection()?.removeAllRanges()
  })
}

export function openDeck(paper) {
  _paper = paper
  _previewIndex = 0
  resetPdf()
  setPdfPanelOpen(false)
  // slides_md === '' (el usuario borró todo) se respeta; solo un paper que
  // nunca tuvo deck arranca con la plantilla intro / desarrollo / conclusión.
  editor().value = paper?.slides_md != null ? paper.slides_md : buildStarterDeck(paper)
  editor().scrollTop = 0
  renderPreview()
}

export function getDeckSlides() {
  return splitSlides(editor().value)
}

export async function flushDeckDraft() {
  clearTimeout(_saveTimer)
  _saveTimer = null
  await saveDraft()
}

export function closeDeck() {
  if (_saveTimer) flushDeckDraft().catch(() => {})
  resetPdf()
}

// ── Borrador ─────────────────────────────────────────────────────────────────

function scheduleSave() {
  clearTimeout(_saveTimer)
  _saveTimer = setTimeout(() => { _saveTimer = null; saveDraft().catch(() => {}) }, SAVE_DEBOUNCE_MS)
}

async function saveDraft() {
  if (!_paper) return
  const markdown = editor().value
  // El paper que recibe la Clase es state.activePaper: así, volver a entrar
  // a la Clase en esta misma sesión ya trae el borrador sin releer la DB.
  _paper.slides_md = markdown
  await window.api.classSaveSlidesDraft({ paperId: _paper.id, markdown })
}

// ── Preview ──────────────────────────────────────────────────────────────────

function syncPreviewToCursor() {
  const ta = editor()
  const idx = slideIndexAtOffset(ta.value, ta.selectionStart)
  if (idx !== _previewIndex || ta.value !== renderPreview._lastValue) {
    _previewIndex = idx
    renderPreview()
  }
}

function renderPreview() {
  const value  = editor().value
  renderPreview._lastValue = value
  const slides = splitSlides(value)
  const stage  = $('class-deck-stage')
  const count  = $('class-slides-count')
  if (count) count.textContent = slides.length ? t('deck-n-slides').replace('{n}', slides.length) : ''

  if (!slides.length) {
    stage.innerHTML = `<p class="class-no-slides">${escAttr(t('deck-slide-vacia'))}</p>`
    $('class-deck-indicator').textContent = '—'
    $('class-deck-prev').disabled = true
    $('class-deck-next').disabled = true
    return
  }
  _previewIndex = Math.max(0, Math.min(_previewIndex, slides.length - 1))
  mountSlide(stage, slides[_previewIndex])
  $('class-deck-indicator').textContent = `${_previewIndex + 1} / ${slides.length}`
  $('class-deck-prev').disabled = _previewIndex === 0
  $('class-deck-next').disabled = _previewIndex === slides.length - 1
}

function goToSlide(index) {
  const ta = editor()
  const total = splitSlides(ta.value).length
  if (index < 0 || index >= total) return
  _previewIndex = index
  const pos = slideOffset(ta.value, index)
  ta.focus()
  ta.setSelectionRange(pos, pos)
  scrollEditorTo(pos)
  renderPreview()
}

function scrollEditorTo(pos) {
  const ta = editor()
  const line = ta.value.slice(0, pos).split('\n').length - 1
  const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 20
  ta.scrollTop = Math.max(0, line * lineHeight - ta.clientHeight / 3)
}

// ── Edición ──────────────────────────────────────────────────────────────────

// execCommand('insertText') mantiene el historial de Ctrl+Z del textarea;
// setRangeText es el fallback (y ahí hay que avisar el cambio a mano).
function insertText(text) {
  const ta = editor()
  // Con el panel PDF abierto el textarea está oculto y no puede tomar foco:
  // se inserta directo en la posición del cursor que tenía al abrir el panel.
  if (pdfPanelOpen()) {
    ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end')
    ta.dispatchEvent(new Event('input'))
    return
  }
  ta.focus()
  if (!document.execCommand('insertText', false, text)) {
    ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end')
    ta.dispatchEvent(new Event('input'))
  }
}

// Desde el panel PDF: inserta y avisa en qué slide quedó (el editor no se ve).
function insertFromPdf(block) {
  insertBlock(block)
  const ta = editor()
  const n = slideIndexAtOffset(ta.value, ta.selectionStart) + 1
  toast(t('deck-insertado').replace('{n}', n))
}

// Inserta un bloque en el cursor, separado por líneas en blanco del texto vecino.
function insertBlock(block) {
  const ta = editor()
  const before = ta.value.slice(0, ta.selectionStart)
  const after  = ta.value.slice(ta.selectionEnd)
  const prefix = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
  const suffix = !after || after.startsWith('\n') ? '\n' : '\n\n'
  insertText(prefix + block + suffix)
}

function insertNewSlide() {
  const ta = editor()
  const value = ta.value
  const slides = splitSlides(value)
  const current = slideIndexAtOffset(value, ta.selectionStart)
  const template = '## Nueva slide\n\n- '

  if (!slides.length || current >= slides.length - 1) {
    // Al final del documento
    const trimmed = value.replace(/\s+$/, '')
    ta.focus()
    ta.setSelectionRange(trimmed.length, value.length)
    insertText((trimmed ? '\n\n---\n\n' : '') + template)
  } else {
    // Justo antes del separador que abre la slide siguiente
    const nextStart = slideOffset(value, current + 1)
    const sepStart  = value.lastIndexOf('---', nextStart)
    ta.focus()
    ta.setSelectionRange(sepStart, sepStart)
    insertText('---\n\n' + template + '\n\n')
    const caret = sepStart + ('---\n\n' + template).length
    ta.setSelectionRange(caret, caret)
  }
  scrollEditorTo(ta.selectionStart)
  syncPreviewToCursor()
}

// ── Panel PDF ────────────────────────────────────────────────────────────────

// Con el panel abierto, el PDF ocupa todo el espacio del editor (el editor y
// la preview se ocultan): se eligen las frases ahí y se cierra para volver a
// la slide, donde ya quedaron insertadas.
function setPdfPanelOpen(open) {
  $('class-deck-pdf').classList.toggle('hidden', !open)
  $('class-deck-editor').classList.toggle('pdf-open', open)
  $('class-deck-toggle-pdf').classList.toggle('active', open)
  if (!open) $('class-deck-insert-selection').classList.add('hidden')
}

function togglePdfPanel() {
  const opening = $('class-deck-pdf').classList.contains('hidden')
  setPdfPanelOpen(opening)
  if (opening && !_pdf.doc && !_pdf.source) loadPaperPdf()
  if (!opening) {
    // De vuelta en el editor: cursor y preview donde quedó lo último insertado
    const ta = editor()
    ta.focus()
    scrollEditorTo(ta.selectionStart)
    syncPreviewToCursor()
  }
}

function pdfPanelOpen() {
  return !$('class-deck-pdf').classList.contains('hidden')
}

function resetPdf() {
  _pdf.loadId++
  _pdf.doc?.destroy?.()
  _pdf = { ..._pdf, doc: null, source: null, name: '', highlights: [] }
  const pages = $('class-deck-pdf-pages')
  if (pages) pages.innerHTML = ''
  const list = $('class-deck-hl-list')
  if (list) list.innerHTML = ''
  const name = $('class-deck-pdf-name')
  if (name) name.textContent = ''
  $('class-deck-insert-selection')?.classList.add('hidden')
}

function paperHighlights() {
  try {
    return JSON.parse(_paper?.highlights || '[]').map(h => ({
      text: h.text, comment: h.comment || '', page: h.pages?.[0]?.page ?? null, pages: h.pages || []
    }))
  } catch (_) {
    return []
  }
}

async function loadPaperPdf() {
  if (!_paper) return
  resetPdf()
  _pdf.source = 'paper'
  _pdf.name = _paper.title || _paper.id
  _pdf.highlights = paperHighlights()
  $('class-deck-pdf-name').textContent = _pdf.name
  renderHighlightList()
  const url = await window.api.getPdfUrl(_paper.id)
  if (!url) {
    $('class-deck-pdf-pages').innerHTML = `<p class="class-deck-pdf-msg">${escAttr(t('deck-sin-pdf'))}</p>`
    return
  }
  await loadPdfDoc(url)
}

async function pickPdf() {
  const picked = await window.api.classPickPdf()
  if (!picked) return
  resetPdf()
  _pdf.source = 'file'
  _pdf.name = picked.name
  $('class-deck-pdf-name').textContent = picked.name
  await loadPdfDoc(picked.url)
}

async function loadPdfDoc(url) {
  const loadId = _pdf.loadId
  const pagesEl = $('class-deck-pdf-pages')
  pagesEl.innerHTML = '<p class="class-deck-pdf-msg">…</p>'
  try {
    const doc = await pdfjsLib.getDocument(url).promise
    if (loadId !== _pdf.loadId) { doc.destroy(); return }
    _pdf.doc = doc
    if (_pdf.source === 'file') {
      _pdf.highlights = await extractAnnotationHighlights(doc, loadId)
      if (loadId !== _pdf.loadId) return
      renderHighlightList()
    }
    await renderPdfPages()
  } catch (err) {
    if (loadId !== _pdf.loadId) return
    console.error('[class-deck] PDF load error:', err)
    pagesEl.innerHTML = `<p class="class-deck-pdf-msg">${escAttr(t('deck-error-pdf'))}</p>`
  }
}

// Destacados hechos en otro lector viven como anotaciones del PDF: se lee el
// texto que queda bajo sus quadPoints y el comentario que tengan adjunto.
async function extractAnnotationHighlights(doc, loadId) {
  const out = []
  for (let i = 1; i <= doc.numPages; i++) {
    if (loadId !== _pdf.loadId) return out
    const page = await doc.getPage(i)
    const annots = (await page.getAnnotations()).filter(a => HIGHLIGHT_SUBTYPES.has(a.subtype) && a.quadPoints)
    if (!annots.length) continue
    const { items } = await page.getTextContent()
    for (const a of annots) {
      const text = textUnderQuads(items, a.quadPoints)
      const comment = a.contentsObj?.str || a.contents || ''
      if (text || comment) out.push({ text, comment, page: i, pages: [] })
    }
  }
  return out
}

function renderHighlightList() {
  const list  = $('class-deck-hl-list')
  const count = $('class-deck-hl-count')
  const hls   = _pdf.highlights
  count.textContent = hls.length ? `(${hls.length})` : ''
  if (!hls.length) {
    list.innerHTML = `<p class="class-deck-hl-empty">${escAttr(t('deck-sin-destacados'))}</p>`
    return
  }
  list.innerHTML = hls.map((h, i) => {
    const quote = h.text.length > 220 ? h.text.slice(0, 220) + '…' : h.text
    const page  = h.page ? `<button class="class-deck-hl-page" data-page="${h.page}">${escAttr(t('deck-pagina').replace('{n}', h.page))}</button>` : ''
    return `
      <div class="class-deck-hl-item">
        <div class="class-deck-hl-text">${quote ? `"${escAttr(quote)}"` : ''}</div>
        ${h.comment ? `<div class="class-deck-hl-comment">— ${escAttr(h.comment)}</div>` : ''}
        <div class="class-deck-hl-actions">
          ${page}
          <button class="class-deck-tool-btn class-deck-hl-insert" data-idx="${i}">${escAttr(t('deck-insertar'))}</button>
        </div>
      </div>`
  }).join('')

  list.querySelectorAll('.class-deck-hl-insert').forEach(btn => {
    btn.addEventListener('click', () => {
      const h = _pdf.highlights[Number(btn.dataset.idx)]
      if (h) insertFromPdf(highlightToMarkdown(h.text ? h : { text: h.comment }))
    })
  })
  list.querySelectorAll('.class-deck-hl-page').forEach(btn => {
    btn.addEventListener('click', () => {
      const pageDiv = $('class-deck-pdf-pages').querySelector(`.pdf-page[data-page="${btn.dataset.page}"]`)
      pageDiv?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  })
}

async function renderPdfPages() {
  const doc = _pdf.doc
  if (!doc) return
  const loadId  = _pdf.loadId
  const pagesEl = $('class-deck-pdf-pages')
  const ratio   = pagesEl.scrollHeight > 0 ? pagesEl.scrollTop / pagesEl.scrollHeight : 0
  pagesEl.innerHTML = ''

  for (let i = 1; i <= doc.numPages; i++) {
    if (loadId !== _pdf.loadId || doc !== _pdf.doc) return
    const page     = await doc.getPage(i)
    const viewport = page.getViewport({ scale: _pdf.scale })

    const pageDiv = document.createElement('div')
    pageDiv.className = 'pdf-page'
    pageDiv.dataset.page = i
    pageDiv.style.width  = viewport.width  + 'px'
    pageDiv.style.height = viewport.height + 'px'
    // pdf.js 3.x dimensiona la capa de texto con esta variable
    pageDiv.style.setProperty('--scale-factor', viewport.scale)

    const canvas  = document.createElement('canvas')
    canvas.width  = viewport.width
    canvas.height = viewport.height
    pageDiv.appendChild(canvas)

    const textDiv = document.createElement('div')
    textDiv.className = 'textLayer'
    pageDiv.appendChild(textDiv)
    pagesEl.appendChild(pageDiv)

    // Un PDF externo pinta sus propias anotaciones (los destacados de otro
    // lector) en el canvas; los de la app se dibujan aparte, como en el lector.
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
    if (_pdf.source === 'paper') drawStoredHighlights(pageDiv, i)
    const textContent = await page.getTextContent()
    await pdfjsLib.renderTextLayer({ textContentSource: textContent, container: textDiv, viewport, textDivs: [] }).promise
  }
  pagesEl.scrollTop = ratio * pagesEl.scrollHeight
}

function drawStoredHighlights(pageDiv, pageNum) {
  const layer = document.createElement('div')
  layer.className = 'highlightLayer'
  for (const h of _pdf.highlights) {
    for (const pd of h.pages) {
      if (pd.page !== pageNum) continue
      for (const stored of pd.rects) {
        const r = rectToScreen(stored, _pdf.scale)
        const div = document.createElement('div')
        div.className = 'pdf-highlight'
        Object.assign(div.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' })
        layer.appendChild(div)
      }
    }
  }
  if (layer.childElementCount) pageDiv.appendChild(layer)
}

async function zoomPdf(direction) {
  const next = Math.min(PDF_SCALE_MAX, Math.max(PDF_SCALE_MIN, _pdf.scale + direction * PDF_SCALE_STEP))
  if (next === _pdf.scale) return
  _pdf.scale = Math.round(next * 100) / 100
  await renderPdfPages()
}

function showInsertSelectionButton() {
  const btn = $('class-deck-insert-selection')
  const sel = window.getSelection()
  const text = sel ? sel.toString().trim() : ''
  if (!text || text.length < 3 || !$('class-deck-pdf-pages').contains(sel.anchorNode)) {
    btn.classList.add('hidden')
    return
  }
  const rect  = sel.getRangeAt(0).getBoundingClientRect()
  const panel = $('class-deck-pdf').getBoundingClientRect()
  btn.style.top  = Math.max(4, rect.bottom - panel.top + 6) + 'px'
  btn.style.left = Math.max(4, Math.min(rect.left - panel.left, panel.width - 170)) + 'px'
  btn.classList.remove('hidden')
}
