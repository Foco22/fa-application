import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildCronExpression, createScheduler } from '../../src/scheduler.js'

// ─── buildCronExpression ──────────────────────────────────────────────────────

describe('buildCronExpression', () => {
  it('builds cron for Monday at 09:00', () => {
    expect(buildCronExpression('monday', '09:00')).toBe('0 9 * * 1')
  })

  it('builds cron for Friday at 18:30', () => {
    expect(buildCronExpression('friday', '18:30')).toBe('30 18 * * 5')
  })

  it('builds cron for Sunday at 00:00', () => {
    expect(buildCronExpression('sunday', '00:00')).toBe('0 0 * * 0')
  })

  it('builds cron for Wednesday at 14:45', () => {
    expect(buildCronExpression('wednesday', '14:45')).toBe('45 14 * * 3')
  })

  it('handles all seven days', () => {
    const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday']
    days.forEach((day, index) => {
      const expr = buildCronExpression(day, '12:00')
      expect(expr).toBe(`0 12 * * ${index}`)
    })
  })

  it('throws on unrecognised day name', () => {
    expect(() => buildCronExpression('funday', '09:00')).toThrow()
  })
})

// ─── createScheduler ─────────────────────────────────────────────────────────

describe('createScheduler', () => {
  let fakeCron
  let capturedExpr
  let capturedTask
  let taskHandle

  beforeEach(() => {
    capturedExpr = null
    capturedTask = null
    taskHandle = { stop: vi.fn() }

    fakeCron = {
      schedule: vi.fn((expr, task) => {
        capturedExpr = expr
        capturedTask = task
        return taskHandle
      })
    }
  })

  it('does not schedule when both categoryList and authorList are empty', () => {
    const settings = { categoryList: '', authorList: '', fetchDay: 'monday', fetchHour: '09:00' }
    createScheduler(settings, vi.fn(), fakeCron)
    expect(fakeCron.schedule).not.toHaveBeenCalled()
  })

  it('schedules a cron job when categoryList is set', () => {
    const settings = { categoryList: 'cs.AI', authorList: '', fetchDay: 'monday', fetchHour: '09:00' }
    createScheduler(settings, vi.fn(), fakeCron)
    expect(fakeCron.schedule).toHaveBeenCalledOnce()
  })

  it('schedules a cron job when authorList is set', () => {
    const settings = { categoryList: '', authorList: 'LeCun', fetchDay: 'tuesday', fetchHour: '10:00' }
    createScheduler(settings, vi.fn(), fakeCron)
    expect(fakeCron.schedule).toHaveBeenCalledOnce()
  })

  it('uses the correct cron expression from fetchDay and fetchHour', () => {
    const settings = { categoryList: 'cs.AI', authorList: '', fetchDay: 'friday', fetchHour: '18:30' }
    createScheduler(settings, vi.fn(), fakeCron)
    expect(capturedExpr).toBe('30 18 * * 5')
  })

  it('calls the onFetch callback when the cron fires', () => {
    const settings = { categoryList: 'cs.AI', authorList: '', fetchDay: 'monday', fetchHour: '09:00' }
    const onFetch = vi.fn()
    createScheduler(settings, onFetch, fakeCron)

    capturedTask() // simulate cron firing
    expect(onFetch).toHaveBeenCalledOnce()
  })

  it('returns a stop() function', () => {
    const settings = { categoryList: 'cs.AI', authorList: '', fetchDay: 'monday', fetchHour: '09:00' }
    const scheduler = createScheduler(settings, vi.fn(), fakeCron)
    expect(typeof scheduler.stop).toBe('function')
  })

  it('stop() calls the underlying task handle stop', () => {
    const settings = { categoryList: 'cs.AI', authorList: '', fetchDay: 'monday', fetchHour: '09:00' }
    const scheduler = createScheduler(settings, vi.fn(), fakeCron)
    scheduler.stop()
    expect(taskHandle.stop).toHaveBeenCalledOnce()
  })

  it('returns null when no job was scheduled', () => {
    const settings = { categoryList: '', authorList: '', fetchDay: 'monday', fetchHour: '09:00' }
    const result = createScheduler(settings, vi.fn(), fakeCron)
    expect(result).toBeNull()
  })
})
