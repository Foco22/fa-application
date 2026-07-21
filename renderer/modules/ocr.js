import { state } from './state.js'
import { toast } from './toast.js'
import { t } from './language.js'
import { renderMarkdown } from '../summary-utils.js'

// Inyectado desde app.js para evitar el ciclo de imports app.js↔ocr.js (mismo
// patrón que initPaperView con _switchTab — ver renderer/modules/language.js).
let _switchTab = () => {}
export function initOcr({ switchTab }) {
  _switchTab = switchTab
}

// ¿El proveedor LLM activo puede hacer OCR? DeepSeek no soporta visión; sin
// API key tampoco hay proveedor. Replica el criterio del guard del backend.
function providerSupportsVision(settings) {
  return (settings.llmProvider || 'openai') !== 'deepseek' && !!settings.apiKey
}

function ocrErrorMessage(error) {
  switch (error) {
    case 'no-vision':     return t('el-proveedor-llm-actual-no-soporta-vision-ocr')
    case 'no-pdf':        return t('no-se-encontro-el-pdf-de-este-paper-en-el-vault')
    case 'not-found':     return t('el-paper-ya-no-existe')
    case 'no-rasterizer': return t('no-se-pudo-rasterizar-el-pdf')
    default:              return t('error-al-generar-ocr') + (error ? `: ${error}` : '.')
  }
}

// Badge "Texto: OCR / extracción básica" + estado de los botones de OCR.
export async function renderOcrSection(p) {
  const badge     = document.getElementById('pv-text-source')
  const btn       = document.getElementById('btn-ocr')
  const reloadBtn = document.getElementById('btn-ocr-reload')
  const openBtn   = document.getElementById('btn-ocr-open')
  const tabBtn    = document.getElementById('tab-btn-ocr')
  const hint      = document.getElementById('pv-ocr-hint')
  const progress  = document.getElementById('pv-ocr-progress')
  if (!badge || !btn) return

  const isOcr = p.pdf_text_source === 'ocr'
  badge.textContent = t(isOcr ? 'texto-ocr' : 'texto-extraccion-basica')
  badge.className   = `status-badge ${isOcr ? 'badge-ocr' : 'badge-basic'}`

  progress.classList.add('hidden')
  progress.textContent = ''
  btn.textContent = t(isOcr ? 'regenerar-ocr' : 'generar-ocr')
  reloadBtn.classList.toggle('hidden', !isOcr)
  openBtn.classList.toggle('hidden', !isOcr)
  tabBtn?.classList.toggle('hidden', !isOcr)

  const settings = await window.api.getSettings()
  const supportsVision = providerSupportsVision(settings)
  btn.disabled = !supportsVision
  if (!supportsVision) {
    hint.textContent = t(settings.apiKey ? 'ocr-hint-no-vision' : 'ocr-hint-no-api-key')
    hint.classList.remove('hidden')
  } else {
    hint.classList.add('hidden')
  }
}

// Overlay de carga: bloquea toda interacción con la app mientras corre el OCR
// (igual que #fetch-overlay durante el fetch semanal) y va mostrando la página
// que se está transcribiendo, para que el usuario no toque nada a medias.
function showOcrOverlay() {
  const overlay = document.getElementById('ocr-overlay')
  const text    = document.getElementById('ocr-overlay-text')
  if (!overlay) return
  text.textContent = t('preparando-transcripcion')
  overlay.classList.remove('hidden')
}

function updateOcrOverlay(page, total) {
  const text = document.getElementById('ocr-overlay-text')
  if (text) text.textContent = t('transcribiendo-pagina').replace('{page}', page).replace('{total}', total)
}

function hideOcrOverlay() {
  document.getElementById('ocr-overlay')?.classList.add('hidden')
}

export async function generateOcr() {
  if (!state.activePaper) return
  const btn      = document.getElementById('btn-ocr')
  const progress = document.getElementById('pv-ocr-progress')

  const original = btn.textContent
  btn.disabled = true
  btn.textContent = t('transcribiendo')
  progress.textContent = t('preparando-transcripcion')
  progress.classList.remove('hidden')
  showOcrOverlay()

  window.api.removeAllListeners('ocr-progress')
  window.api.onOcrProgress(({ page, total }) => {
    progress.textContent = t('transcribiendo-pagina').replace('{page}', page).replace('{total}', total)
    updateOcrOverlay(page, total)
  })

  let result
  try {
    result = await window.api.generateOcr({ paperId: state.activePaper.id })
  } catch (err) {
    result = { success: false, error: err?.message }
  }

  hideOcrOverlay()

  if (!result || !result.success) {
    progress.classList.add('hidden')
    btn.disabled = false
    btn.textContent = original
    toast(ocrErrorMessage(result?.error), 'error')
    return
  }

  state.activePaper = await window.api.getPaper(state.activePaper.id)
  await renderOcrSection(state.activePaper)
  toast(
    t(result.fallbackUsed ? 'ocr-completado-con-fallback' : 'ocr-completado-paginas').replace('{pages}', result.pageCount),
    result.fallbackUsed ? 'info' : 'success'
  )
}

export async function reloadOcr() {
  if (!state.activePaper) return
  let result
  try {
    result = await window.api.reloadOcrFromFile(state.activePaper.id)
  } catch (err) {
    result = { success: false, error: err?.message }
  }
  if (!result || !result.success) {
    toast(t(result?.error === 'no-file'
      ? 'no-hay-archivo-ocr-en-disco-para-este-paper'
      : 'no-se-pudo-recargar-el-ocr-desde-el-archivo'), 'error')
    return
  }
  state.activePaper = await window.api.getPaper(state.activePaper.id)
  await renderOcrSection(state.activePaper)
  toast(t('texto-recargado-desde-el-archivo-editado'), 'success')
}

// Muestra el OCR renderizado (headers, tablas, LaTeX-como-texto, etc.) en su
// propia pestaña dentro de la app — no abre ocr/<id>.md con el editor del
// sistema, que lo mostraría como texto plano sin formato.
export function openOcrFile() {
  if (!state.activePaper) return
  const content = document.getElementById('pv-ocr-content')
  if (content) content.innerHTML = renderMarkdown(state.activePaper.pdf_text || '')
  _switchTab('ocr')
}
