import { state } from './state.js'
import { toast } from './toast.js'
import { escAttr } from './utils.js'
import { scheduleNotesSave, notesGetText, buildLineDiv, flushNotesRender } from './notes.js'
import { dispatchChat } from './chat.js'
import { t } from './language.js'

export function hideAnnotationPopup() {
  document.getElementById('annotation-popup').classList.add('hidden')
  state.annotationText  = ''
  state.annotationRects = null
}

export function setupAnnotationPopup() {
  const popup   = document.getElementById('annotation-popup')
  const viewer  = document.getElementById('pdf-viewer')

  viewer.addEventListener('mouseup', () => {
    setTimeout(() => {
      const sel  = window.getSelection()
      const text = sel ? sel.toString().trim() : ''
      if (!text || text.length < 3) { hideAnnotationPopup(); return }

      state.annotationText  = text
      state.annotationRects = captureHighlightRects()
      const preview = text.length > 120 ? text.slice(0, 120) + '…' : text
      document.getElementById('annotation-preview').textContent = `"${preview}"`
      document.getElementById('annotation-comment').value = ''

      const range = sel.getRangeAt(0)
      const rect  = range.getBoundingClientRect()
      positionAnnotationPopup(rect)
      popup.classList.remove('hidden')
      document.getElementById('annotation-comment').focus()
    }, 10)
  })

  document.addEventListener('mousedown', (e) => {
    if (!popup.classList.contains('hidden') &&
        !popup.contains(e.target) &&
        !e.target.closest('#pdf-viewer')) {
      hideAnnotationPopup()
    }
  })

  document.getElementById('btn-annotation-cancel').addEventListener('click', () => {
    hideAnnotationPopup()
    window.getSelection()?.removeAllRanges()
  })

  document.getElementById('btn-annotation-confirm').addEventListener('click', () => {
    const comment = document.getElementById('annotation-comment').value.trim()
    addHighlightToNotes(state.annotationText, comment)
    hideAnnotationPopup()
    window.getSelection()?.removeAllRanges()
  })

  document.getElementById('annotation-comment').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      document.getElementById('btn-annotation-confirm').click()
    }
    if (e.key === 'Escape') {
      document.getElementById('btn-annotation-cancel').click()
    }
  })
}

function positionAnnotationPopup(rect) {
  const popup = document.getElementById('annotation-popup')
  const W   = 380
  const H   = 240
  const gap = 10
  let top  = rect.bottom + gap
  let left = rect.left

  if (left + W > window.innerWidth - gap) left = window.innerWidth - W - gap
  if (left < gap) left = gap
  if (top + H > window.innerHeight - gap) top = rect.top - H - gap
  if (top < gap) top = gap

  popup.style.top  = top  + 'px'
  popup.style.left = left + 'px'
}

function captureHighlightRects() {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  const clientRects = Array.from(range.getClientRects())
  const pages  = document.querySelectorAll('.pdf-page')
  const result = []

  pages.forEach((pageDiv, idx) => {
    const pr = pageDiv.getBoundingClientRect()
    const rects = clientRects
      .filter(r => r.width > 1 && r.height > 1 && r.top < pr.bottom && r.bottom > pr.top)
      .map(r => ({
        x: Math.round(r.left - pr.left),
        y: Math.round(r.top  - pr.top),
        w: Math.round(r.width),
        h: Math.round(r.height)
      }))
    if (rects.length) result.push({ page: idx + 1, rects })
  })

  return result.length ? result : null
}

export function drawHighlight(highlight) {
  const pages = document.querySelectorAll('.pdf-page')
  ;(highlight.pages || []).forEach(pd => {
    const pageDiv = pages[pd.page - 1]
    if (!pageDiv) return

    let layer = pageDiv.querySelector('.highlightLayer')
    if (!layer) {
      layer = document.createElement('div')
      layer.className = 'highlightLayer'
      pageDiv.appendChild(layer)
    }

    pd.rects.forEach(r => {
      const div = document.createElement('div')
      div.className = 'pdf-highlight'
      div.dataset.hlId = highlight.id
      div.style.left   = r.x + 'px'
      div.style.top    = r.y + 'px'
      div.style.width  = r.w + 'px'
      div.style.height = r.h + 'px'
      layer.appendChild(div)
    })
  })
}

export function loadSavedHighlights() {
  if (!state.activePaper || !state.activePaper.highlights) return
  try {
    JSON.parse(state.activePaper.highlights).forEach(drawHighlight)
  } catch (_) {}
}

export function toggleHighlightsPanel() {
  state.highlightsPanelOpen = !state.highlightsPanelOpen
  const panel = document.getElementById('pdf-highlights-panel')
  panel.classList.toggle('hidden', !state.highlightsPanelOpen)
  document.getElementById('btn-highlights-toggle').classList.toggle('active-btn', state.highlightsPanelOpen)
  if (state.highlightsPanelOpen) renderHighlightsPanel()
}

export function renderHighlightsPanel() {
  const list = document.getElementById('phl-list')
  if (!list) return
  const highlights = []
  try {
    if (state.activePaper?.highlights) highlights.push(...JSON.parse(state.activePaper.highlights))
  } catch (_) {}

  if (!highlights.length) {
    list.innerHTML = '<p class="phl-empty">Sin destacados aún.<br>Seleccioná texto en el PDF para agregar.</p>'
    return
  }

  list.innerHTML = highlights.map((h, i) => `
    <div class="phl-item" data-hl-id="${escAttr(h.id)}">
      <div class="phl-item-top phl-goto" data-id="${escAttr(h.id)}" title=t('ir-al-destacado')>
        <span class="phl-num">#${h.num ?? (i + 1)}</span>
        <span class="phl-quote">${escAttr(h.text.length > 200 ? h.text.slice(0, 200) + '…' : h.text)}</span>
      </div>
      ${h.comment ? `<div class="phl-comment">— ${escAttr(h.comment)}</div>` : ''}
      <div class="phl-actions">
        <button class="phl-btn phl-btn-ai"   data-id="${escAttr(h.id)}">AI</button>
        <button class="phl-btn phl-btn-edit" data-id="${escAttr(h.id)}">Editar</button>
        <button class="phl-btn phl-btn-del"  data-id="${escAttr(h.id)}">Eliminar</button>
      </div>
    </div>
  `).join('')

  list.querySelectorAll('.phl-goto').forEach(el => {
    el.addEventListener('click', () => scrollToHighlight(el.dataset.id))
  })
  list.querySelectorAll('.phl-btn-del').forEach(btn => {
    btn.addEventListener('click', () => deleteHighlight(btn.dataset.id))
  })
  list.querySelectorAll('.phl-btn-edit').forEach(btn => {
    btn.addEventListener('click', () => startEditHighlight(btn.dataset.id))
  })
  list.querySelectorAll('.phl-btn-ai').forEach(btn => {
    btn.addEventListener('click', () => askAiAboutHighlight(btn.dataset.id))
  })
}

function scrollToHighlight(id) {
  const el     = document.querySelector(`.pdf-highlight[data-hl-id="${id}"]`)
  const viewer = document.getElementById('pdf-viewer')
  if (!el || !viewer) return
  const vr = viewer.getBoundingClientRect()
  const er = el.getBoundingClientRect()
  viewer.scrollTo({ top: viewer.scrollTop + er.top - vr.top - vr.height / 2 + er.height / 2, behavior: 'smooth' })
}

function askAiAboutHighlight(id) {
  let highlights = []
  try { highlights = JSON.parse(state.activePaper?.highlights || '[]') } catch (_) {}
  const hl = highlights.find(h => h.id === id)
  if (!hl) return

  const prompt = hl.comment
    ? `Explicame este fragmento del paper y también el comentario que hice:\n\nFragmento: "${hl.text}"\n\nMi comentario: "${hl.comment}"`
    : `Explicame este fragmento del paper:\n\n"${hl.text}"`

  dispatchChat(prompt)
}

export function syncNotesFromHighlights() {
  if (!state.activePaper) return
  let highlights = []
  try { if (state.activePaper.highlights) highlights = JSON.parse(state.activePaper.highlights) } catch (_) {}

  const commentLineSet = new Set()
  highlights.forEach(h => {
    if (h.comment) h.comment.split('\n').map(l => l.trim()).filter(Boolean).forEach(l => commentLineSet.add(l))
  })

  const current = notesGetText()
  const freeLines = []
  let inHlBlock = false
  for (const line of current.split('\n')) {
    if (/^### Nota \d+$/.test(line)) { inHlBlock = true; continue }
    if (inHlBlock) {
      if (line.trim() === '') inHlBlock = false
      continue
    }
    if (/^> (\[\d+\] )?"/.test(line) || /^> — /.test(line)) continue
    if (line.trim() && commentLineSet.has(line.trim())) continue
    freeLines.push(line)
  }
  const freeText = freeLines.join('\n').trim()

  const hlLines = highlights.flatMap((h, i) => {
    const num      = h.num ?? (i + 1)
    const flatText = h.text.replace(/\s*\n\s*/g, ' ').trim()
    const lines    = [`### Nota ${num}`, `**Destacado:** "${flatText}"`]
    if (h.comment) lines.push(`**Comentario:** ${h.comment.replace(/\n+/g, ' ').trim()}`)
    lines.push('')
    return lines
  })

  const parts = [...hlLines, ...(freeText ? [freeText] : [])]
  const updated = parts.join('\n')

  const editor = document.getElementById('pv-notes')
  if (!editor) return
  state.currentNotesLine = null
  editor.innerHTML = updated.trim()
    ? updated.split('\n').map(buildLineDiv).join('')
    : '<div class="notes-line" data-md=""><br></div>'
  state.activePaper = { ...state.activePaper, notes: updated }
  scheduleNotesSave()
}

export function rebuildNotesFromHighlights() {
  if (!state.activePaper) return
  let highlights = []
  try { if (state.activePaper.highlights) highlights = JSON.parse(state.activePaper.highlights) } catch (_) {}

  const hlLines = highlights.flatMap((h, i) => {
    const num      = h.num ?? (i + 1)
    const flatText = h.text.replace(/\s*\n\s*/g, ' ').trim()
    const lines    = [`### Nota ${num}`, `**Destacado:** "${flatText}"`]
    if (h.comment) lines.push(`**Comentario:** ${h.comment.replace(/\n+/g, ' ').trim()}`)
    lines.push('')
    return lines
  })

  const updated = hlLines.join('\n')
  const editor  = document.getElementById('pv-notes')
  if (!editor) return
  state.currentNotesLine = null
  editor.innerHTML = updated.trim()
    ? updated.split('\n').map(buildLineDiv).join('')
    : '<div class="notes-line" data-md=""><br></div>'
  state.activePaper = { ...state.activePaper, notes: updated }
  scheduleNotesSave()
  toast(t('notas-reconstruidas'))
}

export function deleteHighlight(id) {
  if (!state.activePaper) return
  let highlights = []
  try { highlights = JSON.parse(state.activePaper.highlights || '[]') } catch (_) {}
  highlights = highlights.filter(h => h.id !== id)
  const hlJson = JSON.stringify(highlights)
  state.activePaper = { ...state.activePaper, highlights: hlJson }
  window.api.saveHighlights({ paperId: state.activePaper.id, highlights: hlJson })

  document.querySelectorAll(`.pdf-highlight[data-hl-id="${id}"]`).forEach(el => el.remove())
  syncNotesFromHighlights()
  renderHighlightsPanel()
}

export function startEditHighlight(id) {
  const item = document.querySelector(`.phl-item[data-hl-id="${id}"]`)
  if (!item) return
  let highlights = []
  try { highlights = JSON.parse(state.activePaper?.highlights || '[]') } catch (_) {}
  const hl = highlights.find(h => h.id === id)
  if (!hl) return

  const commentDiv = item.querySelector('.phl-comment')
  const actionsDiv = item.querySelector('.phl-actions')
  commentDiv.style.display = 'none'
  actionsDiv.style.display = 'none'

  const textarea = document.createElement('textarea')
  textarea.className = 'phl-edit-input'
  textarea.rows = 2
  textarea.value = hl.comment || ''
  textarea.placeholder = t('comentario-opcional')

  const saveBtn   = document.createElement('button')
  saveBtn.className = 'phl-btn'
  saveBtn.textContent = t('guardar')

  const cancelBtn = document.createElement('button')
  cancelBtn.className = 'phl-btn'
  cancelBtn.textContent = t('cancelar')

  const editRow = document.createElement('div')
  editRow.className = 'phl-actions'
  editRow.append(textarea)
  editRow.style.flexDirection = 'column'
  item.appendChild(textarea)
  item.appendChild(editRow)
  editRow.appendChild(saveBtn)
  editRow.appendChild(cancelBtn)
  textarea.focus()

  const finish = () => { item.remove(); renderHighlightsPanel() }

  saveBtn.addEventListener('click', () => {
    hl.comment = textarea.value.trim()
    const hlJson = JSON.stringify(highlights)
    state.activePaper = { ...state.activePaper, highlights: hlJson }
    window.api.saveHighlights({ paperId: state.activePaper.id, highlights: hlJson })
    syncNotesFromHighlights()
    finish()
  })
  cancelBtn.addEventListener('click', finish)
  textarea.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveBtn.click() }
    if (e.key === 'Escape') cancelBtn.click()
  })
}

export function addHighlightToNotes(text, comment) {
  if (!state.activePaper) return

  const stored = state.activePaper.highlights ? JSON.parse(state.activePaper.highlights) : []
  const num    = stored.length + 1

  const highlight = { id: Date.now().toString(), num, text, comment, pages: state.annotationRects || [] }
  drawHighlight(highlight)

  stored.push(highlight)
  const hlJson = JSON.stringify(stored)
  state.activePaper  = { ...state.activePaper, highlights: hlJson }
  window.api.saveHighlights({ paperId: state.activePaper.id, highlights: hlJson })
  if (state.highlightsPanelOpen) renderHighlightsPanel()

  syncNotesFromHighlights()
  toast(t('anadido-a-notas'))
}
