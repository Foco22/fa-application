const LITELLM_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'

const DEFAULT_INTERVAL_DAYS = 7

// Los únicos modelos que esta app puede llegar a llamar y pagar. El JSON de
// LiteLLM trae ~3.000 modelos; cotizar todos sería guardar basura, y además
// esta lista es la que se usa para validar que una descarga sirve.
//
// La clave es el id tal como lo indexa LiteLLM: los modelos de Groq van
// prefijados (`groq/...`) aunque el proveedor nos devuelva el id pelado.
const KNOWN_MODELS = [
  { provider: 'openai',    model: 'gpt-4o' },
  { provider: 'openai',    model: 'gpt-4o-mini' },
  { provider: 'openai',    model: 'gpt-4-turbo' },
  { provider: 'openai',    model: 'o3-mini' },
  { provider: 'anthropic', model: 'claude-opus-4-8' },
  { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
  { provider: 'deepseek',  model: 'deepseek-v4-flash' },
  { provider: 'deepseek',  model: 'deepseek-v4-pro' },
  { provider: 'deepseek',  model: 'deepseek-chat' },
  { provider: 'deepseek',  model: 'deepseek-reasoner' },
  { provider: 'openai',    model: 'text-embedding-3-small' },
  { provider: 'openai',    model: 'text-embedding-3-large' },
  { provider: 'openai',    model: 'gpt-4o-mini-transcribe' },
  { provider: 'openai',    model: 'whisper-1' },
  { provider: 'groq',      model: 'groq/whisper-large-v3-turbo' },
]

// Precios verificados a mano contra la página oficial del proveedor (2026-07).
// LiteLLM cotiza deepseek-chat/deepseek-reasoner con la tarifa vieja
// ($0.28/$0.42 por MTok); DeepSeek los reasignó como modos de deepseek-v4-flash
// y hoy cuestan $0.14/$0.28. Sin este override el gasto de DeepSeek saldría al
// doble en el dashboard. `source: 'manual'` hace que el refresh no los pise.
const SEED_OVERRIDES = [
  { provider: 'deepseek', model: 'deepseek-chat',     prompt_price_per_token: 0.00000014, completion_price_per_token: 0.00000028, unit: 'token' },
  { provider: 'deepseek', model: 'deepseek-reasoner', prompt_price_per_token: 0.00000014, completion_price_per_token: 0.00000028, unit: 'token' },
]

// Groq nos devuelve `whisper-large-v3-turbo` pero LiteLLM lo indexa como
// `groq/whisper-large-v3-turbo`. Sin traducir la clave, el lookup falla justo
// para el modelo que más se usa (transcripción de clases) y todo el gasto de
// Groq quedaría como "costo desconocido".
function normalizeModelKey(provider, model) {
  if (provider === 'groq' && model && !model.startsWith('groq/')) return `groq/${model}`
  return model
}

function isPositiveNumber(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0
}

// Extrae solo los modelos que usamos y valida que sus precios sean numéricos.
// Lanza si el payload no sirve — el caller lo traduce en "conservar la tabla
// anterior", nunca en aceptar precios corruptos.
function parsePricingPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Tabla de precios inválida: se esperaba un objeto de modelos')
  }

  const rows = []
  for (const { provider, model } of KNOWN_MODELS) {
    const entry = payload[model]
    if (!entry || typeof entry !== 'object') continue  // modelo no cubierto: se omite, no invalida la tabla

    const hasTokenPrices = 'input_cost_per_token' in entry || 'output_cost_per_token' in entry
    const hasAudioPrice  = 'input_cost_per_second' in entry

    if (hasAudioPrice && !isPositiveNumber(entry.input_cost_per_second)) {
      throw new Error(`Precio de audio no numérico para ${model}`)
    }
    if (hasTokenPrices) {
      if (!isPositiveNumber(entry.input_cost_per_token) || !isPositiveNumber(entry.output_cost_per_token)) {
        throw new Error(`Precio de tokens no numérico para ${model}`)
      }
    }
    if (!hasTokenPrices && !hasAudioPrice) continue

    // Un modelo de audio puede cotizar por segundo (whisper) o por token
    // (gpt-4o-mini-transcribe) — no se asume un solo modelo de cobro.
    rows.push({
      provider,
      model,
      prompt_price_per_token:     hasTokenPrices ? entry.input_cost_per_token  : null,
      completion_price_per_token: hasTokenPrices ? entry.output_cost_per_token : null,
      audio_price_per_second:     hasAudioPrice  ? entry.input_cost_per_second : null,
      unit:   hasAudioPrice && !hasTokenPrices ? 'second' : 'token',
      source: 'litellm',
    })
  }

  if (rows.length === 0) {
    throw new Error('Tabla de precios inválida: no cotiza ningún modelo que la app use')
  }
  return rows
}

// Nunca lanza: un fallo de red o un payload corrupto se reportan como null para
// que el caller conserve la última tabla válida.
async function fetchPricingTable(httpClient) {
  try {
    const res = await httpClient.get(LITELLM_URL)
    return parsePricingPayload(res.data)
  } catch (err) {
    console.error(`[pricing] fetch falló: ${err.message}`)
    return null
  }
}

function saveManualOverride(db, provider, model, prices) {
  db.savePricingRows([{
    provider,
    model,
    prompt_price_per_token:     prices.prompt_price_per_token ?? null,
    completion_price_per_token: prices.completion_price_per_token ?? null,
    audio_price_per_second:     prices.audio_price_per_second ?? null,
    unit: prices.unit || (prices.audio_price_per_second != null ? 'second' : 'token'),
    source: 'manual',
  }])
}

function isStale(lastFetched, intervalDays, now) {
  if (!lastFetched) return true
  const age = now - new Date(lastFetched).getTime()
  return age > intervalDays * 24 * 3600 * 1000
}

async function refreshPricingIfStale(db, httpClient, { force = false, now = Date.now() } = {}) {
  const intervalDays = parseFloat(db.getSetting('pricingFetchIntervalDays') || String(DEFAULT_INTERVAL_DAYS))
  const lastFetched  = db.getSetting('pricingLastFetched')

  if (!force && !isStale(lastFetched, intervalDays, now)) return { updated: false, skipped: true }

  const rows = await fetchPricingTable(httpClient)
  if (!rows) {
    // Sin internet o payload corrupto: se conserva la tabla anterior y no se
    // toca pricingLastFetched, que refleja la última descarga *exitosa*.
    return { updated: false, error: 'No se pudo actualizar la tabla de precios' }
  }

  db.savePricingRows(rows)
  db.savePricingRows(SEED_OVERRIDES.map(o => ({ ...o, source: 'manual' })))
  db.saveSetting('pricingLastFetched', new Date(now).toISOString())
  return { updated: true, count: rows.length }
}

function getPriceFor(db, provider, model) {
  return db.getPricingRow(provider, normalizeModelKey(provider, model)) || null
}

module.exports = {
  LITELLM_URL, KNOWN_MODELS, SEED_OVERRIDES, DEFAULT_INTERVAL_DAYS,
  normalizeModelKey, parsePricingPayload, fetchPricingTable,
  refreshPricingIfStale, getPriceFor, saveManualOverride,
}
