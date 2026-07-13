import { describe, it, expect, vi } from 'vitest'
import { openDatabase } from '../../../src/database.js'
import { recordUsage, makeUsageRecorder, computeCostMicroUsd } from '../../../src/costs/index.js'

function dbWithPrices() {
  const db = openDatabase(':memory:')
  db.savePricingRows([
    { provider: 'anthropic', model: 'claude-opus-4-8', prompt_price_per_token: 0.000005, completion_price_per_token: 0.000025, unit: 'token' },
    { provider: 'openai', model: 'text-embedding-3-small', prompt_price_per_token: 0.00000002, completion_price_per_token: 0, unit: 'token' },
    { provider: 'groq', model: 'groq/whisper-large-v3-turbo', audio_price_per_second: 0.00001111, unit: 'second' },
  ])
  return db
}

// ─── computeCostMicroUsd ──────────────────────────────────────────────────────

describe('computeCostMicroUsd', () => {
  const TOKEN_PRICE = { prompt_price_per_token: 0.000005, completion_price_per_token: 0.000025 }

  it('charges prompt and completion tokens at their own rates', () => {
    // 1000 * 5e-6 = $0.005 ; 500 * 25e-6 = $0.0125 ; total $0.0175 = 17500 micro
    expect(computeCostMicroUsd({ prompt_tokens: 1000, completion_tokens: 500 }, TOKEN_PRICE)).toBe(17500)
  })

  it('returns an integer, rounding sub-micro fractions', () => {
    const cost = computeCostMicroUsd({ prompt_tokens: 1, completion_tokens: 0 }, TOKEN_PRICE)
    expect(Number.isInteger(cost)).toBe(true)
  })

  it('charges audio by the second when the model is priced per second', () => {
    // 120s * 1.111e-5 = $0.0013332 -> 1333 micro
    expect(computeCostMicroUsd({ audio_seconds: 120 }, { audio_price_per_second: 0.00001111 })).toBe(1333)
  })

  // Sin precio no se inventa un costo: null significa "desconocido", que en el
  // dashboard se reporta aparte en vez de sumarse como gratis.
  it('returns null when there is no price for the model', () => {
    expect(computeCostMicroUsd({ prompt_tokens: 1000 }, null)).toBeNull()
  })

  it('returns null when the provider reported no usage at all', () => {
    expect(computeCostMicroUsd({}, TOKEN_PRICE)).toBeNull()
  })
})

// ─── recordUsage ──────────────────────────────────────────────────────────────

describe('recordUsage', () => {
  it('prices an LLM call and persists the event', () => {
    const db = dbWithPrices()
    recordUsage(db, {
      action_type: 'summary', provider: 'anthropic', model: 'claude-opus-4-8',
      prompt_tokens: 1000, completion_tokens: 500,
    })

    const row = db.getUsageEvents()[0]
    expect(row).toMatchObject({ action_type: 'summary', provider: 'anthropic', cost_micro_usd: 17500 })
  })

  // El precio usado queda congelado en la fila: si mañana el proveedor cambia la
  // tarifa, el historial de gasto no se reescribe solo.
  it('freezes the unit prices used, so later price changes do not rewrite history', () => {
    const db = dbWithPrices()
    recordUsage(db, { action_type: 'chat', provider: 'anthropic', model: 'claude-opus-4-8', prompt_tokens: 100, completion_tokens: 10 })

    db.savePricingRows([{ provider: 'anthropic', model: 'claude-opus-4-8', prompt_price_per_token: 999, completion_price_per_token: 999, unit: 'token', source: 'manual' }])

    const row = db.getUsageEvents()[0]
    expect(row.prompt_price_per_token).toBe(0.000005)
    expect(row.cost_micro_usd).toBe(750)
  })

  it('resolves groq models through the normalized key', () => {
    const db = dbWithPrices()
    recordUsage(db, { action_type: 'transcription', provider: 'groq', model: 'whisper-large-v3-turbo', audio_seconds: 120 })
    expect(db.getUsageEvents()[0].cost_micro_usd).toBe(1333)
  })

  // Los proveedores locales son gratis pero no invisibles: el dashboard debe
  // mostrar "Local — $0" como su propia serie.
  it('records local providers as a real event costing zero, not as unknown', () => {
    const db = dbWithPrices()
    recordUsage(db, { action_type: 'embedding', provider: 'local', model: 'Xenova/all-MiniLM-L6-v2', prompt_tokens: 500 })

    const row = db.getUsageEvents()[0]
    expect(row.cost_micro_usd).toBe(0)
    expect(db.getUnknownCostCount()).toBe(0)
  })

  it('stores an unpriced model with a null cost instead of dropping the event', () => {
    const db = dbWithPrices()
    recordUsage(db, { action_type: 'chat', provider: 'openai', model: 'gpt-9-unreleased', prompt_tokens: 100, completion_tokens: 10 })

    expect(db.getUsageEvents()).toHaveLength(1)
    expect(db.getUsageEvents()[0].cost_micro_usd).toBeNull()
    expect(db.getUnknownCostCount()).toBe(1)
  })

  // Un fallo del tracking NUNCA puede tumbar la acción del usuario: si no se
  // puede registrar el costo, se loguea y el resumen/quiz/chat sigue su curso.
  it('never throws, even if the database write fails', () => {
    const broken = { getPricingRow: () => { throw new Error('db is gone') } }
    expect(() => recordUsage(broken, { action_type: 'chat', provider: 'openai', model: 'gpt-4o' })).not.toThrow()
  })
})

// ─── makeUsageRecorder ────────────────────────────────────────────────────────

describe('makeUsageRecorder', () => {
  it('binds a db so providers can record without knowing about it', () => {
    const db = dbWithPrices()
    const onUsage = makeUsageRecorder(db)
    onUsage({ action_type: 'quiz', provider: 'anthropic', model: 'claude-opus-4-8', prompt_tokens: 1000, completion_tokens: 500 })
    expect(db.getUsageEvents()[0].cost_micro_usd).toBe(17500)
  })
})
