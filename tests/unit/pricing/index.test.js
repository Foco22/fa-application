import { describe, it, expect, vi } from 'vitest'
import { openDatabase } from '../../../src/database.js'
import {
  normalizeModelKey,
  parsePricingPayload,
  fetchPricingTable,
  refreshPricingIfStale,
  getPriceFor,
  saveManualOverride,
  SEED_OVERRIDES,
  LITELLM_URL,
} from '../../../src/pricing/index.js'

// Forma real del JSON de LiteLLM, recortada a lo que la app consume.
const PAYLOAD = {
  'gpt-4o':                     { mode: 'chat',    input_cost_per_token: 0.0000025,  output_cost_per_token: 0.00001 },
  'gpt-4o-mini':                { mode: 'chat',    input_cost_per_token: 0.00000015, output_cost_per_token: 0.0000006 },
  'claude-opus-4-8':            { mode: 'chat',    input_cost_per_token: 0.000005,   output_cost_per_token: 0.000025 },
  'deepseek-chat':              { mode: 'chat',    input_cost_per_token: 0.00000028, output_cost_per_token: 0.00000042 },
  'text-embedding-3-small':     { mode: 'embedding', input_cost_per_token: 0.00000002, output_cost_per_token: 0 },
  'groq/whisper-large-v3-turbo':{ mode: 'audio_transcription', input_cost_per_second: 0.00001111 },
  'whisper-1':                  { mode: 'audio_transcription', input_cost_per_second: 0.0001 },
  'gpt-4o-mini-transcribe':     { mode: 'audio_transcription', input_cost_per_token: 0.00000125, output_cost_per_token: 0.000005 },
  'some-other-model':           { mode: 'chat',    input_cost_per_token: 0.1, output_cost_per_token: 0.2 },
}

function makeHttp(data = PAYLOAD) {
  return { get: vi.fn().mockResolvedValue({ data }) }
}

// ─── normalizeModelKey ────────────────────────────────────────────────────────

describe('normalizeModelKey', () => {
  // LiteLLM indexa los modelos de Groq con prefijo; el proveedor nos devuelve el
  // id pelado. Sin esta traducción el lookup de precio falla justo para el
  // modelo que más se usa en las clases.
  it('prefixes groq models, which LiteLLM keys as groq/<model>', () => {
    expect(normalizeModelKey('groq', 'whisper-large-v3-turbo')).toBe('groq/whisper-large-v3-turbo')
  })

  it('does not double-prefix a model that already carries the prefix', () => {
    expect(normalizeModelKey('groq', 'groq/whisper-large-v3-turbo')).toBe('groq/whisper-large-v3-turbo')
  })

  it('leaves openai, anthropic and deepseek ids untouched', () => {
    expect(normalizeModelKey('openai', 'gpt-4o')).toBe('gpt-4o')
    expect(normalizeModelKey('anthropic', 'claude-opus-4-8')).toBe('claude-opus-4-8')
    expect(normalizeModelKey('deepseek', 'deepseek-chat')).toBe('deepseek-chat')
  })
})

// ─── parsePricingPayload ──────────────────────────────────────────────────────

describe('parsePricingPayload', () => {
  it('extracts token prices for the models the app can use', () => {
    const rows = parsePricingPayload(PAYLOAD)
    const gpt4o = rows.find(r => r.model === 'gpt-4o')
    expect(gpt4o).toMatchObject({
      provider: 'openai',
      prompt_price_per_token: 0.0000025,
      completion_price_per_token: 0.00001,
      unit: 'token',
      source: 'litellm',
    })
  })

  it('extracts per-second audio prices and marks the unit as second', () => {
    const rows = parsePricingPayload(PAYLOAD)
    const groq = rows.find(r => r.model === 'groq/whisper-large-v3-turbo')
    expect(groq).toMatchObject({ provider: 'groq', audio_price_per_second: 0.00001111, unit: 'second' })
  })

  it('ignores the thousands of models the app never calls', () => {
    const rows = parsePricingPayload(PAYLOAD)
    expect(rows.find(r => r.model === 'some-other-model')).toBeUndefined()
  })

  it('rejects the payload when a price we need is not a number', () => {
    const corrupt = { ...PAYLOAD, 'gpt-4o': { mode: 'chat', input_cost_per_token: 'free', output_cost_per_token: 0.00001 } }
    expect(() => parsePricingPayload(corrupt)).toThrow(/gpt-4o/)
  })

  it('rejects a payload that is not an object of models', () => {
    expect(() => parsePricingPayload(null)).toThrow()
    expect(() => parsePricingPayload([])).toThrow()
  })

  // Si LiteLLM renombra o quita los modelos que usamos, preferimos conservar la
  // tabla vieja antes que aceptar una nueva que no cotiza nada de lo que llamamos.
  it('rejects a well-formed payload that covers none of our models', () => {
    expect(() => parsePricingPayload({ 'some-other-model': { mode: 'chat', input_cost_per_token: 1, output_cost_per_token: 2 } }))
      .toThrow(/ningún modelo/i)
  })
})

// ─── fetchPricingTable ────────────────────────────────────────────────────────

describe('fetchPricingTable', () => {
  it('downloads from the LiteLLM url via the injected http client', async () => {
    const http = makeHttp()
    await fetchPricingTable(http)
    expect(http.get).toHaveBeenCalledWith(LITELLM_URL)
  })

  it('returns parsed rows on success', async () => {
    const rows = await fetchPricingTable(makeHttp())
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every(r => r.source === 'litellm')).toBe(true)
  })

  it('returns null instead of throwing when the network fails', async () => {
    const http = { get: vi.fn().mockRejectedValue(new Error('ENOTFOUND')) }
    expect(await fetchPricingTable(http)).toBeNull()
  })

  it('returns null when the payload is corrupt, so the caller keeps the old table', async () => {
    const http = makeHttp({ 'gpt-4o': { mode: 'chat', input_cost_per_token: null, output_cost_per_token: null } })
    expect(await fetchPricingTable(http)).toBeNull()
  })
})

// ─── refreshPricingIfStale ────────────────────────────────────────────────────

describe('refreshPricingIfStale', () => {
  let db

  it('fetches and stores when there is no cached table yet', async () => {
    db = openDatabase(':memory:')
    const http = makeHttp()
    const res = await refreshPricingIfStale(db, http)

    expect(http.get).toHaveBeenCalled()
    expect(res.updated).toBe(true)
    expect(db.getPricingRow('openai', 'gpt-4o').prompt_price_per_token).toBe(0.0000025)
    expect(db.getSetting('pricingLastFetched')).toBeTruthy()
  })

  it('skips the fetch when the cache is fresher than pricingFetchIntervalDays', async () => {
    db = openDatabase(':memory:')
    await refreshPricingIfStale(db, makeHttp())

    const http = makeHttp()
    const res = await refreshPricingIfStale(db, http)
    expect(http.get).not.toHaveBeenCalled()
    expect(res.updated).toBe(false)
  })

  it('fetches again once the cache is older than the interval', async () => {
    db = openDatabase(':memory:')
    await refreshPricingIfStale(db, makeHttp())

    const old = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString()
    db.saveSetting('pricingLastFetched', old)

    const http = makeHttp()
    await refreshPricingIfStale(db, http)
    expect(http.get).toHaveBeenCalled()
  })

  it('forces the fetch regardless of freshness when asked', async () => {
    db = openDatabase(':memory:')
    await refreshPricingIfStale(db, makeHttp())

    const http = makeHttp()
    const res = await refreshPricingIfStale(db, http, { force: true })
    expect(http.get).toHaveBeenCalled()
    expect(res.updated).toBe(true)
  })

  // El dashboard tiene que seguir andando sin internet: se conserva la última
  // tabla válida y no se pisa la fecha de la última actualización exitosa.
  it('keeps the previous table and reports the failure when the fetch fails', async () => {
    db = openDatabase(':memory:')
    await refreshPricingIfStale(db, makeHttp())
    const lastFetched = db.getSetting('pricingLastFetched')

    const failing = { get: vi.fn().mockRejectedValue(new Error('offline')) }
    const res = await refreshPricingIfStale(db, failing, { force: true })

    expect(res.updated).toBe(false)
    expect(res.error).toBeTruthy()
    expect(db.getPricingRow('openai', 'gpt-4o').prompt_price_per_token).toBe(0.0000025)
    expect(db.getSetting('pricingLastFetched')).toBe(lastFetched)
  })

  it('never lets a refresh overwrite a manual override', async () => {
    db = openDatabase(':memory:')
    saveManualOverride(db, 'openai', 'gpt-4o', { prompt_price_per_token: 0.999, completion_price_per_token: 0.111 })

    await refreshPricingIfStale(db, makeHttp(), { force: true })

    const row = db.getPricingRow('openai', 'gpt-4o')
    expect(row.source).toBe('manual')
    expect(row.prompt_price_per_token).toBe(0.999)
  })

  // LiteLLM cotiza deepseek-chat/reasoner con la tarifa vieja ($0.28/$0.42);
  // el precio oficial vigente es $0.14/$0.28. Sin esto el gasto de DeepSeek
  // saldría al doble en el dashboard.
  it('seeds the verified overrides for models LiteLLM prices wrong', async () => {
    db = openDatabase(':memory:')
    await refreshPricingIfStale(db, makeHttp())

    const row = db.getPricingRow('deepseek', 'deepseek-chat')
    expect(row.source).toBe('manual')
    expect(row.prompt_price_per_token).toBe(0.00000014)
    expect(row.completion_price_per_token).toBe(0.00000028)
    expect(SEED_OVERRIDES.some(o => o.model === 'deepseek-chat')).toBe(true)
  })
})

// ─── getPriceFor ──────────────────────────────────────────────────────────────

describe('getPriceFor', () => {
  it('returns the cached price for a known provider+model', async () => {
    const db = openDatabase(':memory:')
    await refreshPricingIfStale(db, makeHttp())
    expect(getPriceFor(db, 'openai', 'gpt-4o')).toMatchObject({ prompt_price_per_token: 0.0000025 })
  })

  it('resolves groq models through the normalized key', async () => {
    const db = openDatabase(':memory:')
    await refreshPricingIfStale(db, makeHttp())
    expect(getPriceFor(db, 'groq', 'whisper-large-v3-turbo')).toMatchObject({ audio_price_per_second: 0.00001111 })
  })

  // Nunca bloquear la acción principal del usuario por no saber el precio.
  it('returns null for an unknown model instead of throwing', async () => {
    const db = openDatabase(':memory:')
    await refreshPricingIfStale(db, makeHttp())
    expect(getPriceFor(db, 'openai', 'gpt-5-unreleased')).toBeNull()
  })

  it('prefers a manual override over the downloaded price', async () => {
    const db = openDatabase(':memory:')
    await refreshPricingIfStale(db, makeHttp())
    saveManualOverride(db, 'openai', 'gpt-4o', { prompt_price_per_token: 0.5, completion_price_per_token: 0.6 })
    expect(getPriceFor(db, 'openai', 'gpt-4o')).toMatchObject({ prompt_price_per_token: 0.5, source: 'manual' })
  })
})
