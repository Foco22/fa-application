import { describe, it, expect } from 'vitest'
import { openDatabase } from '../../../src/database.js'
import { getCostSummary } from '../../../src/costs/index.js'

function seed(db) {
  const ev = (occurred_at, provider, action_type, cost_micro_usd) =>
    db.saveUsageEvent({ occurred_at, provider, action_type, model: 'm', cost_micro_usd })

  ev('2026-03-02 10:00:00', 'anthropic', 'summary',  200000)  // lunes, semana del 2
  ev('2026-03-03 10:00:00', 'groq',      'transcription', 26700)
  ev('2026-03-05 10:00:00', 'anthropic', 'chat',      50000)
  ev('2026-03-09 10:00:00', 'openai',    'embedding',    13)   // semana siguiente
  ev('2026-04-01 10:00:00', 'anthropic', 'summary',  100000)  // otro mes
  return db
}

function makeDb() {
  return seed(openDatabase(':memory:'))
}

describe('getCostSummary — agrupación temporal', () => {
  it('groups by day', () => {
    const { buckets } = getCostSummary(makeDb(), { groupBy: 'day' })
    expect(buckets.map(b => b.period)).toEqual(['2026-03-02', '2026-03-03', '2026-03-05', '2026-03-09', '2026-04-01'])
    expect(buckets[0].total_micro_usd).toBe(200000)
  })

  // Las semanas arrancan el lunes, igual que el resto de la app (vault, dashboard
  // de aprendizaje) — no se usa el domingo de strftime('%W').
  it('groups by week, with weeks starting on Monday', () => {
    const { buckets } = getCostSummary(makeDb(), { groupBy: 'week' })
    expect(buckets.map(b => b.period)).toEqual(['2026-03-02', '2026-03-09', '2026-03-30'])
    // lunes 2 + martes 3 + jueves 5 caen todos en la semana del lunes 2
    expect(buckets[0].total_micro_usd).toBe(276700)
  })

  it('groups by month', () => {
    const { buckets } = getCostSummary(makeDb(), { groupBy: 'month' })
    expect(buckets.map(b => b.period)).toEqual(['2026-03', '2026-04'])
    expect(buckets[0].total_micro_usd).toBe(276713)
  })

  it('breaks each bucket down by provider', () => {
    const { buckets } = getCostSummary(makeDb(), { groupBy: 'week' })
    expect(buckets[0].by_provider).toEqual({ anthropic: 250000, groq: 26700 })
  })

  it('filters by date range', () => {
    const { buckets, total_micro_usd } = getCostSummary(makeDb(), { groupBy: 'day', from: '2026-03-04', to: '2026-03-31' })
    expect(buckets.map(b => b.period)).toEqual(['2026-03-05', '2026-03-09'])
    expect(total_micro_usd).toBe(50013)
  })

  it('is empty, not broken, when there is no usage at all', () => {
    const summary = getCostSummary(openDatabase(':memory:'), { groupBy: 'week' })
    expect(summary.buckets).toEqual([])
    expect(summary.total_micro_usd).toBe(0)
    expect(summary.all_time_micro_usd).toBe(0)
  })
})

describe('getCostSummary — totales y desgloses', () => {
  it('reports the total for the filtered range and the all-time total separately', () => {
    const summary = getCostSummary(makeDb(), { groupBy: 'month', from: '2026-04-01', to: '2026-04-30' })
    expect(summary.total_micro_usd).toBe(100000)
    expect(summary.all_time_micro_usd).toBe(376713)
  })

  it('breaks down by action type within the range', () => {
    const { by_action } = getCostSummary(makeDb(), { groupBy: 'month', from: '2026-03-01', to: '2026-03-31' })
    const summary = by_action.find(a => a.action_type === 'summary')
    expect(summary).toMatchObject({ action_type: 'summary', provider: 'anthropic', model: 'm', events: 1, total_micro_usd: 200000 })
  })

  // Saber que gastaste en "resumen con anthropic" sin saber con qué modelo no
  // sirve para decidir nada: Opus y Haiku difieren 5x en precio.
  it('separates the same action by model, since price depends on the model', () => {
    const db = openDatabase(':memory:')
    db.saveUsageEvent({ occurred_at: '2026-03-02 10:00:00', provider: 'anthropic', action_type: 'summary', model: 'claude-opus-4-8', cost_micro_usd: 200000 })
    db.saveUsageEvent({ occurred_at: '2026-03-02 11:00:00', provider: 'anthropic', action_type: 'summary', model: 'claude-haiku-4-5-20251001', cost_micro_usd: 40000 })

    const { by_action } = getCostSummary(db, { groupBy: 'week' })
    expect(by_action).toHaveLength(2)
    expect(by_action.map(a => a.model)).toEqual(['claude-opus-4-8', 'claude-haiku-4-5-20251001'])
  })

  it('totals by provider across the whole range', () => {
    const { by_provider } = getCostSummary(makeDb(), { groupBy: 'week' })
    expect(by_provider).toEqual({ anthropic: 350000, groq: 26700, openai: 13 })
  })

  // Un modelo sin precio se cuenta aparte: sumarlo como $0 subestimaría el gasto
  // y el total no cerraría con la factura del proveedor.
  it('counts unknown-cost events apart instead of adding them as zero', () => {
    const db = makeDb()
    db.saveUsageEvent({ occurred_at: '2026-03-02 11:00:00', provider: 'openai', action_type: 'chat', model: 'gpt-9', cost_micro_usd: null })

    const summary = getCostSummary(db, { groupBy: 'week' })
    expect(summary.unknown_cost_events).toBe(1)
    expect(summary.total_micro_usd).toBe(376713)  // sin cambios
  })

  // Un modelo sin precio no puede aparecer como "$0" en la tabla: se distingue
  // "gratis" (local) de "no sabemos cuánto costó".
  it('reports an unpriced action with a null cost, never as zero', () => {
    const db = openDatabase(':memory:')
    db.saveUsageEvent({ occurred_at: '2026-03-02 10:00:00', provider: 'openai', action_type: 'chat', model: 'gpt-9', cost_micro_usd: null })
    db.saveUsageEvent({ occurred_at: '2026-03-02 10:00:00', provider: 'local', action_type: 'embedding', model: 'MiniLM', cost_micro_usd: 0 })

    const { by_action } = getCostSummary(db, { groupBy: 'week' })
    expect(by_action.find(a => a.model === 'gpt-9').total_micro_usd).toBeNull()
    expect(by_action.find(a => a.model === 'MiniLM').total_micro_usd).toBe(0)
  })

  // El proveedor local cuesta 0. Si el consumidor filtra por truthiness, la serie
  // "Local — $0" desaparece del gráfico — el bucket tiene que traer la clave.
  it('keeps a zero-cost provider present in the breakdown, not absent', () => {
    const db = makeDb()
    db.saveUsageEvent({ occurred_at: '2026-03-02 12:00:00', provider: 'local', action_type: 'embedding', model: 'MiniLM', cost_micro_usd: 0 })

    const { buckets, by_provider } = getCostSummary(db, { groupBy: 'week' })
    expect(buckets[0].by_provider).toHaveProperty('local', 0)
    expect(by_provider).toHaveProperty('local', 0)
  })

  it('rejects an unknown groupBy instead of interpolating it into the SQL', () => {
    expect(() => getCostSummary(makeDb(), { groupBy: "day'; DROP TABLE usage_events;--" })).toThrow()
  })
})