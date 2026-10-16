// OCR vía LlamaParse (LlamaCloud). El plan gratuito da 10.000 créditos/mes; el tier
// `cost_effective` (el más barato que devuelve markdown) cuesta ~3 créditos por página.
//
// Flujo REST v2: subir el archivo → crear el job con su file_id → consultar el job
// hasta COMPLETED y leer el markdown por página. El cliente HTTP se inyecta (igual
// que en los proveedores de IA) para que los tests nunca toquen la red.
const BASE_URL         = 'https://api.cloud.llamaindex.ai'
const POLL_INTERVAL_MS = 2000
const TIMEOUT_MS       = 5 * 60 * 1000

const defaultSleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// Mensajes en palabras del usuario; la API key nunca aparece en ellos.
function describeError(err, apiKey) {
  const status = err.response?.status
  if (status === 401 || status === 403) return 'LlamaParse: la API key no es válida (revísala en Configuración)'
  if (status === 402) return 'LlamaParse: sin créditos (se agotaron los del mes)'
  if (status === 429) return 'LlamaParse: límite de peticiones alcanzado, inténtalo en un minuto'
  return `LlamaParse: ${String(err.message || err).split(apiKey).join('***')}`
}

async function parsePdfWithLlamaParse(buffer, {
  apiKey, httpClient, tier = 'cost_effective', onStatus = null,
  sleepFn = defaultSleep, pollIntervalMs = POLL_INTERVAL_MS, timeoutMs = TIMEOUT_MS, now = Date.now,
} = {}) {
  if (!apiKey) return { success: false, error: 'no-api-key', markdown: null }

  const headers = { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }

  try {
    if (onStatus) onStatus('uploading')
    const form = new FormData()
    form.append('purpose', 'parse')
    form.append('file', new Blob([buffer], { type: 'application/pdf' }), 'paper.pdf')
    const upload = await httpClient.post(`${BASE_URL}/api/v1/beta/files`, form, { headers })

    if (onStatus) onStatus('parsing')
    const created = await httpClient.post(
      `${BASE_URL}/api/v2/parse`,
      {
        file_id: upload.data.id, tier, version: 'latest',
        // Tablas como tablas Markdown (no HTML <table><tr><td>…): se leen mejor para el LLM y
        // para ti en el .md. Medido en un paper de 19 páginas: 23 tablas HTML → 334 filas con
        // `|`, y el tamaño solo bajó ~8 % (el relleno de columnas se come parte del ahorro).
        output_options: { markdown: { tables: { output_tables_as_markdown: true } } },
      },
      { headers: { ...headers, 'Content-Type': 'application/json' } },
    )
    const jobId = created.data.id ?? created.data.job?.id

    const start = now()
    for (;;) {
      const { data } = await httpClient.get(`${BASE_URL}/api/v2/parse/${jobId}?expand=markdown`, { headers })
      const status = data?.job?.status ?? data?.status

      if (status === 'COMPLETED') {
        const pages = data.markdown?.pages ?? []
        const markdown = pages.map(p => p.markdown).filter(Boolean).join('\n\n')
        if (!markdown) return { success: false, error: 'LlamaParse: el documento no devolvió contenido', markdown: null }
        return { success: true, markdown, pageCount: pages.length }
      }
      if (status === 'FAILED' || status === 'CANCELLED') {
        const reason = data?.job?.error_message ? `: ${data.job.error_message}` : ''
        return { success: false, error: `LlamaParse: el trabajo terminó como ${status}${reason}`, markdown: null }
      }
      if (now() - start >= timeoutMs) {
        return { success: false, error: `LlamaParse tardó más de ${Math.round(timeoutMs / 60000)} min en responder`, markdown: null }
      }
      await sleepFn(pollIntervalMs)
    }
  } catch (err) {
    return { success: false, error: describeError(err, apiKey), markdown: null }
  }
}

module.exports = { parsePdfWithLlamaParse }
