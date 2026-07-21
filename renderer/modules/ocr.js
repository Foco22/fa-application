import { state } from './state.js'
import { toast } from './toast.js'

// ¿El proveedor LLM activo puede hacer OCR? DeepSeek no soporta visión; sin
// API key tampoco hay proveedor. Replica el criterio del guard del backend.
function providerSupportsVision(settings) {
  return (settings.llmProvider || 'openai') !== 'deepseek' && !!settings.apiKey
}

function ocrErrorMessage(error) {
  switch (error) {
    case 'no-vision':    return 'El proveedor LLM actual no soporta visión (OCR).'
    case 'no-pdf':       return 'No se encontró el PDF de este paper en el vault.'
    case 'not-found':    return 'El paper ya no existe.'
    case 'no-rasterizer':return 'No se pudo rasterizar el PDF.'
    default:             return 'Error al generar OCR' + (error ? `: ${error}` : '.')
  }
}

// Badge "Texto: OCR / extracción básica" + estado de los botones de OCR.
export async function renderOcrSection(p) {
  const badge     = document.getElementById('pv-text-source')
  const btn       = document.getElementById('btn-ocr')
  const reloadBtn = document.getElementById('btn-ocr-reload')
  const openBtn   = document.getElementById('btn-ocr-open')
  const hint      = document.getElementById('pv-ocr-hint')
  const progress  = document.getElementById('pv-ocr-progress')
  if (!badge || !btn) return

  const isOcr = p.pdf_text_source === 'ocr'
  badge.textContent = isOcr ? 'Texto: OCR' : 'Texto: extracción básica'
  badge.className   = `status-badge ${isOcr ? 'badge-ocr' : 'badge-basic'}`

  progress.classList.add('hidden')
  progress.textContent = ''
  btn.textContent = isOcr ? '↺ Regenerar OCR' : 'Generar OCR'
  reloadBtn.classList.toggle('hidden', !isOcr)
  openBtn.classList.toggle('hidden', !isOcr)

  const settings = await window.api.getSettings()
  const supportsVision = providerSupportsVision(settings)
  btn.disabled = !supportsVision
  if (!supportsVision) {
    hint.textContent = settings.apiKey
      ? 'El proveedor actual no soporta visión. Configura OpenAI o Anthropic para generar OCR.'
      : 'Configura una API key de un proveedor con visión (OpenAI o Anthropic) para generar OCR.'
    hint.classList.remove('hidden')
  } else {
    hint.classList.add('hidden')
  }
}

export async function generateOcr() {
  if (!state.activePaper) return
  const btn      = document.getElementById('btn-ocr')
  const progress = document.getElementById('pv-ocr-progress')

  const original = btn.textContent
  btn.disabled = true
  btn.textContent = 'Transcribiendo…'
  progress.textContent = 'Preparando transcripción…'
  progress.classList.remove('hidden')

  window.api.removeAllListeners('ocr-progress')
  window.api.onOcrProgress(({ page, total }) => {
    progress.textContent = `Transcribiendo página ${page}/${total}…`
  })

  let result
  try {
    result = await window.api.generateOcr({ paperId: state.activePaper.id })
  } catch (err) {
    result = { success: false, error: err?.message }
  }

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
    result.fallbackUsed
      ? `OCR completado (${result.pageCount} págs.) — algunas páginas en fallback pdf-parse.`
      : `OCR completado (${result.pageCount} págs.).`,
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
    toast(result?.error === 'no-file'
      ? 'No hay un archivo OCR en disco para este paper.'
      : 'No se pudo recargar el OCR desde el archivo.', 'error')
    return
  }
  state.activePaper = await window.api.getPaper(state.activePaper.id)
  await renderOcrSection(state.activePaper)
  toast('Texto recargado desde el archivo editado.', 'success')
}

export function openOcrFile() {
  if (!state.activePaper) return
  window.api.openOcrFile(state.activePaper.id)
}
