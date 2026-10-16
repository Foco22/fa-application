import { state } from './state.js'
import { toast } from './toast.js'
import { parseSummary, renderMarkdown } from '../summary-utils.js'
import { t } from './language.js'
import { needsOcr } from './ocr-gate.js'

export function renderSummaryCards(text) {
  const sections = parseSummary(text)
  const cards    = document.getElementById('pv-summary-cards')
  sections.forEach((body, i) => {
    document.getElementById(`sc-${i}`).innerHTML = body ? renderMarkdown(body) : '<p>—</p>'
  })
  cards.classList.remove('hidden')
}

export function renderSummarySection(p) {
  const stream = document.getElementById('pv-summary-stream')
  const cards  = document.getElementById('pv-summary-cards')
  const btn    = document.getElementById('btn-summary')

  stream.classList.add('hidden')
  stream.textContent = ''

  if (p.summary) {
    renderSummaryCards(p.summary)
    btn.textContent = t('regenerar')
  } else {
    cards.classList.add('hidden')
    btn.textContent = t('generar')
  }
  btn.disabled = false
}

export async function startSummary() {
  if (!state.activePaper) return
  if (needsOcr(state.activePaper)) { toast(t('ocr-requerido'), 'error'); return }
  const btn    = document.getElementById('btn-summary')
  const stream = document.getElementById('pv-summary-stream')
  const cards  = document.getElementById('pv-summary-cards')

  btn.disabled = true
  btn.textContent = t('generando')
  cards.classList.add('hidden')
  stream.textContent = t('generando-resumen')
  stream.classList.remove('hidden')

  window.api.removeAllListeners('summary-chunk')
  window.api.removeAllListeners('summary-done')
  window.api.removeAllListeners('summary-error')

  let tokenCount = 0
  window.api.onSummaryChunk(chunk => {
    tokenCount += chunk.length
    stream.textContent = `Generando resumen… (${tokenCount} chars)`
  })

  window.api.onSummaryDone(async () => {
    state.activePaper = await window.api.getPaper(state.activePaper.id)
    stream.classList.add('hidden')
    renderSummaryCards(state.activePaper.summary)
    btn.textContent = t('regenerar')
    btn.disabled = false
  })

  window.api.onSummaryError(msg => {
    stream.classList.add('hidden')
    stream.textContent = t('error-prefijo-largo') + msg
    stream.classList.remove('hidden')
    btn.disabled = false
    btn.textContent = t('reintentar')
    toast(t('error-al-generar-resumen') + msg, 'error')
  })

  const result = await window.api.startSummary(state.activePaper.id)
  // Red de seguridad: el proceso principal también exige OCR (p. ej. si el paper cambió).
  if (result?.error === 'ocr-required') {
    stream.classList.add('hidden')
    btn.disabled = false
    btn.textContent = t('generar')
    toast(t('ocr-requerido'), 'error')
  }
}
