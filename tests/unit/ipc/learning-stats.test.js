import { describe, it, expect, vi } from 'vitest'
import { registerLearningStatsHandlers } from '../../../src/ipc/learning-stats.js'

function makeIpcMain() {
  const handlers = {}
  return {
    ipcMain:  { handle: (ch, fn) => { handlers[ch] = fn } },
    invoke:   (ch, ...args) => handlers[ch]({}, ...args),
    handlers,
  }
}

describe('get-weekly-class-counts', () => {
  it('delegates to db.getClassSessionsByWeek with from/to', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const rows = [{ week_start: '2024-01-01', count: 2 }]
    const db = { getClassSessionsByWeek: vi.fn().mockReturnValue(rows) }
    registerLearningStatsHandlers({ ipcMain, db })

    const result = await invoke('get-weekly-class-counts', { from: '2024-01-01', to: '2024-02-01' })

    expect(db.getClassSessionsByWeek).toHaveBeenCalledWith('2024-01-01', '2024-02-01')
    expect(result).toEqual(rows)
  })

  it('defaults to no range when payload is omitted', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const db = { getClassSessionsByWeek: vi.fn().mockReturnValue([]) }
    registerLearningStatsHandlers({ ipcMain, db })

    await invoke('get-weekly-class-counts')

    expect(db.getClassSessionsByWeek).toHaveBeenCalledWith(undefined, undefined)
  })
})

describe('get-class-performance-trend', () => {
  it('delegates to db.getClassPerformanceTrend with from/to', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const rows = [{ week_start: '2024-01-01', avg_clarity: 85, avg_presentation: 80, avg_qa: 70 }]
    const db = { getClassPerformanceTrend: vi.fn().mockReturnValue(rows) }
    registerLearningStatsHandlers({ ipcMain, db })

    const result = await invoke('get-class-performance-trend', { from: '2024-01-01', to: '2024-02-01' })

    expect(db.getClassPerformanceTrend).toHaveBeenCalledWith('2024-01-01', '2024-02-01')
    expect(result).toEqual(rows)
  })
})

describe('get-quiz-performance-trend', () => {
  it('delegates to db.getQuizPerformanceTrend with from/to', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const rows = [{ week_start: '2024-01-01', avg_pct: 90 }]
    const db = { getQuizPerformanceTrend: vi.fn().mockReturnValue(rows) }
    registerLearningStatsHandlers({ ipcMain, db })

    const result = await invoke('get-quiz-performance-trend', { from: '2024-01-01', to: '2024-02-01' })

    expect(db.getQuizPerformanceTrend).toHaveBeenCalledWith('2024-01-01', '2024-02-01')
    expect(result).toEqual(rows)
  })
})

describe('get-weekly-streak', () => {
  it('delegates to db.getWeeklyStreak', async () => {
    const { ipcMain, invoke } = makeIpcMain()
    const streak = { current: 3, best: 5 }
    const db = { getWeeklyStreak: vi.fn().mockReturnValue(streak) }
    registerLearningStatsHandlers({ ipcMain, db })

    const result = await invoke('get-weekly-streak')

    expect(db.getWeeklyStreak).toHaveBeenCalled()
    expect(result).toEqual(streak)
  })
})
