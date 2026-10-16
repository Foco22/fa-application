import { describe, it, expect } from 'vitest'
import { fetchProgressView } from '../../../renderer/modules/fetch-progress.js'

const t = (key) => `[${key}]`

describe('fetchProgressView', () => {
  it('maps each stage into its own slice of one monotonic 0–100% bar', () => {
    const at = (stage, current, total) => fetchProgressView({ stage, current, total }, t).percent

    expect(at('arxiv', 0, 100)).toBe(0)
    expect(at('arxiv', 100, 100)).toBe(40)
    expect(at('embedding', 0, 100)).toBe(40)
    expect(at('embedding', 100, 100)).toBe(70)
    expect(at('rerank', 0, 100)).toBe(70)
    expect(at('rerank', 100, 100)).toBe(90)
    expect(at('saving', 0, 3)).toBe(90)
    expect(at('saving', 3, 3)).toBe(95)
    // El OCR de los papers recién guardados cierra la barra.
    expect(at('ocr', 0, 3)).toBe(95)
    expect(at('ocr', 3, 3)).toBe(100)
  })

  it('interpolates inside a stage', () => {
    expect(fetchProgressView({ stage: 'arxiv', current: 50, total: 100 }, t).percent).toBe(20)
  })

  it('labels the stage and shows current / total', () => {
    const { label } = fetchProgressView({ stage: 'arxiv', current: 2100, total: 4332 }, t)

    expect(label).toContain('[fetch-etapa-arxiv]')
    expect(label).toContain('2100 / 4332')
  })

  it('shows only the stage name (no count) and stays at the start of the slice when the total is unknown', () => {
    const view = fetchProgressView({ stage: 'arxiv', current: 300, total: null }, t)

    expect(view.percent).toBe(0)
    expect(view.label).toBe('[fetch-etapa-arxiv]')
  })

  it('clamps out-of-range counts instead of overflowing the bar', () => {
    expect(fetchProgressView({ stage: 'saving', current: 9, total: 3 }, t).percent).toBe(95)
    expect(fetchProgressView({ stage: 'saving', current: -1, total: 3 }, t).percent).toBe(90)
    expect(fetchProgressView({ stage: 'ocr', current: 9, total: 3 }, t).percent).toBe(100)
  })

  it('returns null for an unknown stage', () => {
    expect(fetchProgressView({ stage: 'nope', current: 1, total: 2 }, t)).toBeNull()
  })
})
