import { describe, it, expect } from 'vitest'
import { weekStartUtc, papersOfThisWeek, hasUserData } from '../../../src/ingestion/week.js'

// SQLite guarda created_at como datetime('now'): UTC, 'YYYY-MM-DD HH:MM:SS'.
const stamp = (d) => d.toISOString().slice(0, 19).replace('T', ' ')

// Los tests construyen fechas en hora LOCAL y comparan contra la misma conversión,
// así pasan igual en cualquier zona horaria (el bug documentado de la semana
// estaba en agrupar por fecha UTC en vez de local).
describe('weekStartUtc', () => {
  it('is the local Monday 00:00 of the current week, expressed in UTC', () => {
    const wednesday = new Date(2026, 9, 14, 15, 30) // mié 14 oct 2026
    expect(weekStartUtc(wednesday)).toBe(stamp(new Date(2026, 9, 12, 0, 0, 0)))
  })

  it('on Monday it is that same day at 00:00', () => {
    expect(weekStartUtc(new Date(2026, 9, 12, 9, 0))).toBe(stamp(new Date(2026, 9, 12, 0, 0, 0)))
  })

  it('on Sunday it still belongs to the week that started the previous Monday', () => {
    expect(weekStartUtc(new Date(2026, 9, 18, 23, 0))).toBe(stamp(new Date(2026, 9, 12, 0, 0, 0)))
  })

  it('has the same shape as SQLite datetime(now), so it compares as a string', () => {
    expect(weekStartUtc(new Date())).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })
})

describe('papersOfThisWeek', () => {
  const now = new Date(2026, 9, 14, 12, 0)

  it('keeps fetched papers created this week and drops the ones from earlier weeks', () => {
    const papers = [
      { id: '2610.00001', created_at: stamp(new Date(2026, 9, 13, 10)) },
      { id: '2610.00002', created_at: stamp(new Date(2026, 9, 11, 10)) }, // domingo anterior
    ]

    expect(papersOfThisWeek(papers, now).map(p => p.id)).toEqual(['2610.00001'])
  })

  it('never counts reference papers (ref-*): indexing a reference is not a weekly fetch', () => {
    const papers = [
      { id: 'ref-attention', created_at: stamp(new Date(2026, 9, 13, 10)) },
      { id: '2610.00001',    created_at: stamp(new Date(2026, 9, 13, 10)) },
    ]

    expect(papersOfThisWeek(papers, now).map(p => p.id)).toEqual(['2610.00001'])
  })

  it('includes a paper created exactly at the start of the week', () => {
    const papers = [{ id: '2610.00001', created_at: weekStartUtc(now) }]

    expect(papersOfThisWeek(papers, now)).toHaveLength(1)
  })

  it('returns [] for an empty list', () => {
    expect(papersOfThisWeek([], now)).toEqual([])
  })
})

describe('hasUserData', () => {
  it.each(['summary', 'quiz', 'notes', 'highlights', 'slides_md'])('is true when %s has content', (field) => {
    expect(hasUserData({ [field]: 'algo' })).toBe(true)
  })

  it('is false for a paper with nothing generated or written', () => {
    expect(hasUserData({ summary: null, quiz: null, notes: '', highlights: null, slides_md: null })).toBe(false)
  })
})
