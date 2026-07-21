import { state } from './state.js'
import { mdInline } from '../summary-utils.js'
import { escAttr } from './utils.js'
import { t } from './language.js'

export function notesLineParts(text) {
  if (!text) return { cls: '', html: '' }
  if (/^### /.test(text)) return { cls: 'md-h3', html: mdInline(text.slice(4)) }
  if (/^## /.test(text))  return { cls: 'md-h2', html: mdInline(text.slice(3)) }
  if (/^# /.test(text))   return { cls: 'md-h1', html: mdInline(text.slice(2)) }
  if (/^> /.test(text))   return { cls: 'md-bq', html: mdInline(text.slice(2)) }
  if (/^[-*] /.test(text)) return { cls: 'md-li', html: '• ' + mdInline(text.slice(2)) }
  if (/^---+$/.test(text.trim())) return { cls: 'md-hr', html: '' }
  return { cls: '', html: mdInline(text) }
}

export function buildLineDiv(raw) {
  const { cls, html } = notesLineParts(raw)
  const clsStr = cls ? `notes-line ${cls}` : 'notes-line'
  return `<div class="${clsStr}" data-md="${escAttr(raw)}">${html || '<br>'}</div>`
}

export function notesRenderLine(div) {
  if (!div || !div.isConnected) return
  const raw = div.dataset.md !== undefined ? div.dataset.md : (div.textContent || '')
  div.dataset.md = raw
  const { cls, html } = notesLineParts(raw)
  div.className = cls ? `notes-line ${cls}` : 'notes-line'
  div.innerHTML = html || '<br>'
}

export function notesFocusedDiv() {
  const editor = document.getElementById('pv-notes')
  if (!editor) return null
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return null
  let node = sel.focusNode
  while (node && node !== editor && node.parentNode !== editor) node = node.parentNode
  if (!node || node === editor) return null
  return (node instanceof HTMLDivElement) ? node : null
}

export function notesActivate(div) {
  if (!div || div === state.currentNotesLine) return
  if (state.currentNotesLine && state.currentNotesLine.isConnected) {
    if (state.currentNotesLine.classList.contains('notes-raw'))
      state.currentNotesLine.dataset.md = state.currentNotesLine.textContent || ''
    notesRenderLine(state.currentNotesLine)
  }
  state.currentNotesLine = div
  const raw = div.dataset.md !== undefined ? div.dataset.md : (div.textContent || '')
  div.dataset.md = raw
  div.className = 'notes-line notes-raw'
  div.textContent = raw
}

export function notesGetText() {
  const editor = document.getElementById('pv-notes')
  if (!editor) return ''
  return Array.from(editor.children).map(div => {
    if (div === state.currentNotesLine && div.classList.contains('notes-raw'))
      return div.textContent || ''
    return div.dataset.md !== undefined ? div.dataset.md : (div.textContent || '')
  }).join('\n')
}

export function flushNotesRender() {
  const editor = document.getElementById('pv-notes')
  if (!editor) return
  if (state.currentNotesLine && state.currentNotesLine.classList.contains('notes-raw'))
    state.currentNotesLine.dataset.md = state.currentNotesLine.textContent || ''
  state.currentNotesLine = null
  Array.from(editor.children).forEach(notesRenderLine)
}

export function renderNotesSection(p) {
  const editor = document.getElementById('pv-notes')
  const indicator = document.getElementById('notes-save-indicator')
  indicator.textContent = ''
  indicator.className = 'save-indicator'
  state.currentNotesLine = null
  const text = p.notes || ''
  editor.innerHTML = text
    ? text.split('\n').map(buildLineDiv).join('')
    : '<div class="notes-line" data-md=""><br></div>'
}

export function onNotesClick() {
  const div = notesFocusedDiv()
  if (!div || div === state.currentNotesLine) return
  notesActivate(div)
  const range = document.createRange()
  range.selectNodeContents(div)
  range.collapse(false)
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
}

export function onNotesKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleNotesEnter(); return }
  if (e.key === 'Backspace')             { handleNotesBackspace(e); return }
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    setTimeout(() => {
      const div = notesFocusedDiv()
      if (div && div !== state.currentNotesLine) notesActivate(div)
    }, 0)
  }
}

function handleNotesEnter() {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return
  const range   = sel.getRangeAt(0)
  const active  = notesFocusedDiv()
  if (!active) return

  if (!range.collapsed) range.deleteContents()

  const before = document.createRange()
  before.selectNodeContents(active)
  before.setEnd(range.startContainer, range.startOffset)
  const textBefore = before.toString()

  const after = document.createRange()
  after.selectNodeContents(active)
  after.setStart(range.startContainer, range.startOffset)
  const textAfter = after.toString()

  active.dataset.md = textBefore
  active.classList.remove('notes-raw')
  notesRenderLine(active)

  const newDiv = document.createElement('div')
  newDiv.className  = 'notes-line notes-raw'
  newDiv.dataset.md = textAfter
  newDiv.textContent = textAfter

  active.insertAdjacentElement('afterend', newDiv)

  const nr = document.createRange()
  if (newDiv.firstChild) nr.setStart(newDiv.firstChild, 0)
  else                   nr.setStart(newDiv, 0)
  nr.collapse(true)
  sel.removeAllRanges()
  sel.addRange(nr)

  state.currentNotesLine = newDiv
  scheduleNotesSave()
}

function handleNotesBackspace(e) {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return
  const range  = sel.getRangeAt(0)
  const active = notesFocusedDiv()
  if (!active) return

  const atStart = range.collapsed && range.startOffset === 0 &&
    (range.startContainer === active ||
     (range.startContainer.nodeType === Node.TEXT_NODE &&
      !range.startContainer.previousSibling))
  if (!atStart) return

  const prevDiv = active.previousElementSibling
  if (!prevDiv) return

  e.preventDefault()

  const prevRaw = prevDiv.dataset.md !== undefined ? prevDiv.dataset.md : (prevDiv.textContent || '')
  const currRaw = active.classList.contains('notes-raw')
    ? (active.textContent || '')
    : (active.dataset.md !== undefined ? active.dataset.md : '')

  const merged  = prevRaw + currRaw
  prevDiv.dataset.md  = merged
  prevDiv.className   = 'notes-line notes-raw'
  prevDiv.textContent = merged

  active.remove()

  const nr = document.createRange()
  if (prevDiv.firstChild) nr.setStart(prevDiv.firstChild, prevRaw.length)
  else                    nr.setStart(prevDiv, 0)
  nr.collapse(true)
  sel.removeAllRanges()
  sel.addRange(nr)

  state.currentNotesLine = prevDiv
  scheduleNotesSave()
}

export function onNotesInput() {
  if (!state.currentNotesLine) {
    const div = notesFocusedDiv()
    if (div) { state.currentNotesLine = div; div.classList.add('notes-raw') }
  }
  if (state.currentNotesLine) state.currentNotesLine.dataset.md = state.currentNotesLine.textContent || ''
  scheduleNotesSave()
}

export function onNotesBlur() { flushNotesRender() }

export function scheduleNotesSave() {
  const indicator = document.getElementById('notes-save-indicator')
  indicator.textContent = t('guardando')
  indicator.className = 'save-indicator saving'
  clearTimeout(state.notesSaveTimer)
  state.notesSaveTimer = setTimeout(async () => {
    const notes = notesGetText()
    await window.api.saveNotes({ paperId: state.activePaper.id, notes })
    state.activePaper = { ...state.activePaper, notes }
    indicator.textContent = t('guardado')
    indicator.className = 'save-indicator saved'
    setTimeout(() => {
      indicator.textContent = ''
      indicator.className = 'save-indicator'
    }, 2000)
  }, 600)
}
