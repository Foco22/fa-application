import { describe, it, expect } from 'vitest'
import { isoWeekMonday, weekDateRange } from '../../../renderer/modules/vault.js'

describe('isoWeekMonday', () => {
  it('returns the Monday of ISO week 1, 2026 (Dec 29, 2025)', () => {
    const monday = isoWeekMonday(2026, 1)
    expect(monday.getFullYear()).toBe(2025)
    expect(monday.getMonth()).toBe(11) // December
    expect(monday.getDate()).toBe(29)
  })

  it('returns the Monday of ISO week 27, 2026 (Jun 29, 2026)', () => {
    const monday = isoWeekMonday(2026, 27)
    expect(monday.getFullYear()).toBe(2026)
    expect(monday.getMonth()).toBe(5) // June
    expect(monday.getDate()).toBe(29)
  })
})

describe('weekDateRange', () => {
  it('formats the Monday–Sunday range as DD/MM/YYYY - DD/MM/YYYY', () => {
    expect(weekDateRange('2026', 'week-27')).toBe('29/06/2026 - 05/07/2026')
  })

  it('handles a week that crosses a month boundary', () => {
    expect(weekDateRange('2026', 'week-31')).toBe('27/07/2026 - 02/08/2026')
  })

  it('handles ISO week 1 correctly even when it starts in the previous calendar year', () => {
    expect(weekDateRange('2026', 'week-01')).toBe('29/12/2025 - 04/01/2026')
  })
})
