// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { isoWeekMonday, weekDateRange, renderVault, autoExpandRecent } from '../../../renderer/modules/vault.js'
import { state } from '../../../renderer/modules/state.js'

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

describe('renderVault — affiliation star', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <span id="vault-count"></span>
      <div id="vault-list"></div>
    `
    // Miércoles/jueves/viernes de la misma semana — a propósito lejos del
    // límite lunes-domingo, para no depender de isoWeek() (bug de timezone
    // conocido y separado, fuera de este plan).
    state.papers = [
      { id: 'p1', title: 'Matched paper', published_date: '2026-01-07', matched_affiliation: 1 },
      { id: 'p2', title: 'Unmatched paper', published_date: '2026-01-08', matched_affiliation: 0 },
      { id: 'p3', title: 'Unevaluated paper', published_date: '2026-01-09', matched_affiliation: null },
    ]
    state.expandedNodes = new Set()
    autoExpandRecent()
  })

  function paperRow(id) {
    return document.querySelector(`.tree-paper[data-id="${id}"]`)
  }

  it('shows the star only for the paper that matched an affiliation', () => {
    renderVault()

    expect(paperRow('p1').querySelector('.affiliation-star')).not.toBeNull()
    expect(paperRow('p2').querySelector('.affiliation-star')).toBeNull()
    expect(paperRow('p3').querySelector('.affiliation-star')).toBeNull()
  })
})
