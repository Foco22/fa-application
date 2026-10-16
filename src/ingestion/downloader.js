const fs = require('fs')
const path = require('path')

const DOWNLOAD_TIMEOUT_MS = 30000 // sin timeout, un PDF colgado bloqueaba todo el fetch
const MAX_ATTEMPTS        = 3     // intentos totales por PDF
const BASE_DELAY_MS       = 1000  // 1s, 2s, ... (backoff lineal)

function defaultSleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Un 200 con HTML (página de rate-limit de ArXiv) no es un PDF: guardarlo
// rompería extractFirstPage/extractText más adelante, lejos de la causa real.
function isPdf(data) {
  return Buffer.from(data).subarray(0, 5).toString('latin1') === '%PDF-'
}

// Errores transitorios: red caída/timeout (sin `response`), 429 y 5xx. Un 4xx
// distinto de 429 significa que la URL o el permiso están mal — reintentar no ayuda.
function isRetryable(err) {
  if (err.notPdf) return true
  if (!err.response) return true
  return err.response.status === 429 || err.response.status >= 500
}

async function downloadPdf(arxivId, pdfUrl, httpClient, destDir, { sleepFn = defaultSleep, baseDelayMs = BASE_DELAY_MS } = {}) {
  const destPath = path.join(destDir, `${arxivId}.pdf`)

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await httpClient.get(pdfUrl, { responseType: 'arraybuffer', timeout: DOWNLOAD_TIMEOUT_MS })
      if (!isPdf(response.data)) {
        throw Object.assign(new Error('La respuesta no es un PDF (posible límite de peticiones de ArXiv)'), { notPdf: true })
      }
      fs.writeFileSync(destPath, response.data)
      return { success: true, path: destPath }
    } catch (err) {
      if (!isRetryable(err)) return { success: false, error: err.message }
      if (attempt === MAX_ATTEMPTS) {
        return { success: false, error: `${err.message} (tras ${attempt} intentos)` }
      }
      console.warn(`[downloader] ${arxivId}: intento ${attempt}/${MAX_ATTEMPTS} falló: ${err.message}. Reintentando...`)
      await sleepFn(baseDelayMs * attempt)
    }
  }
}

module.exports = { downloadPdf, DOWNLOAD_TIMEOUT_MS, MAX_ATTEMPTS }
