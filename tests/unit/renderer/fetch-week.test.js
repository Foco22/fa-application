import { describe, it, expect } from 'vitest'
import { fetchWeekPromptView } from '../../../renderer/modules/fetch-week.js'

const t = (key) => `[${key}]`

describe('fetchWeekPromptView', () => {
  it('returns null (no question to ask) when nothing was fetched this week', () => {
    expect(fetchWeekPromptView({ count: 0, max: 3, papers: [] }, t)).toBeNull()
  })

  it('asks to replace when the week is already full, with no option to complete', () => {
    const view = fetchWeekPromptView({ count: 3, max: 3, papers: [{ id: 'a', title: 'A', hasUserData: false }] }, t)

    expect(view.canComplete).toBe(false)
    expect(view.items).toEqual([{ title: 'A', hasUserData: false }])
  })

  it('offers to complete the missing slots when the week is not full yet', () => {
    const view = fetchWeekPromptView({ count: 2, max: 3, papers: [] }, t)

    expect(view.canComplete).toBe(true)
    expect(view.missing).toBe(1)
  })

  it('warns that content will be lost only when some paper has summary, notes, quiz…', () => {
    const lossy = fetchWeekPromptView({ count: 1, max: 3, papers: [{ id: 'a', title: 'A', hasUserData: true }] }, t)
    const clean = fetchWeekPromptView({ count: 1, max: 3, papers: [{ id: 'a', title: 'A', hasUserData: false }] }, t)

    expect(lossy.warnDataLoss).toBe(true)
    expect(clean.warnDataLoss).toBe(false)
  })

  it('shows the count in the body', () => {
    const view = fetchWeekPromptView({ count: 3, max: 3, papers: [] }, t)

    expect(view.body).toContain('3')
  })
})
