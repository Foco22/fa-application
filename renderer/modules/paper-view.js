import { state } from './state.js'
import { STATUS_KEYS } from './constants.js'
import { renderSummarySection } from './summary.js'
import { renderQuizSection } from './quiz.js'
import { renderNotesSection } from './notes.js'
import { syncNotesFromHighlights, renderHighlightsPanel } from './highlights.js'
import { updateChatContext } from './chat.js'
import { renderOcrSection } from './ocr.js'
import { t } from './language.js'

let _renderVault   = () => {}
let _switchTab     = () => {}
let _setPdfExpanded = () => {}

export function initPaperView({ renderVault, switchTab, setPdfExpanded }) {
  _renderVault    = renderVault
  _switchTab      = switchTab
  _setPdfExpanded = setPdfExpanded
}

export async function openPaper(id, tab = 'resumen') {
  state.activePaper   = await window.api.getPaper(id)
  state.quizAnswers   = {}
  state.quizSubmitted = false
  if (state.pdfExpanded) _setPdfExpanded(false)

  updateChatContext()
  renderPaperView()
  _switchTab(tab)
  _renderVault()
  document.getElementById('content-scroll').scrollTop = 0
}

export function renderPaperView() {
  const p = state.activePaper
  if (!p) return

  document.getElementById('empty-state').classList.add('hidden')
  document.getElementById('paper-view').classList.remove('hidden')

  const badge = document.getElementById('pv-status')
  badge.textContent = STATUS_KEYS[p.status] ? t(STATUS_KEYS[p.status]) : p.status
  badge.className = `status-badge badge-${p.status}`

  document.getElementById('pv-title').textContent    = p.title || p.id
  document.getElementById('pv-authors').textContent  = p.authors || '—'

  let affilText = '⚠ Sin verificar (no en Semantic Scholar)'
  try {
    if (p.affiliations !== null && p.affiliations !== undefined) {
      const aff = typeof p.affiliations === 'string' ? JSON.parse(p.affiliations) : p.affiliations
      if (Array.isArray(aff) && aff.length > 0) {
        const unis = [...new Set(aff.flatMap(a => a.affiliations || []).filter(Boolean))]
        affilText = unis.length > 0 ? `🏛 ${unis.join(' · ')}` : '— Sin afiliación registrada'
      }
    }
  } catch (_) {}
  document.getElementById('pv-affil').textContent = affilText

  document.getElementById('pv-date').textContent = p.published_date
    ? new Date(p.published_date).toLocaleDateString('es', { year: 'numeric', month: 'short', day: 'numeric' })
    : '—'

  document.getElementById('pv-abstract').textContent = p.abstract || '(Sin abstract)'

  const errBlock = document.getElementById('pv-pdf-error')
  if (p.pdf_error) {
    errBlock.classList.remove('hidden')
    document.getElementById('pv-pdf-error-msg').textContent = '⚠ ' + p.pdf_error
  } else {
    errBlock.classList.add('hidden')
  }

  renderSummarySection(p)
  renderQuizSection(p)
  renderNotesSection(p)
  renderOcrSection(p)
  if (p.highlights) syncNotesFromHighlights()
  if (state.highlightsPanelOpen) renderHighlightsPanel()
}
