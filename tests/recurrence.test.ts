import { describe, expect, it } from 'vitest'
import { nextRecurringDate } from '../shared/utils/recurrence'

describe('recurrence dates', () => {
  it('advances daily and weekly dates', () => {
    expect(nextRecurringDate('2026-10-19', 'daily')).toBe('2026-10-20')
    expect(nextRecurringDate('2026-10-19', 'weekly')).toBe('2026-10-26')
  })

  it('handles month, year, and leap-day boundaries', () => {
    expect(nextRecurringDate('2026-01-31', 'daily')).toBe('2026-02-01')
    expect(nextRecurringDate('2026-12-31', 'daily')).toBe('2027-01-01')
    expect(nextRecurringDate('2028-02-28', 'daily')).toBe('2028-02-29')
  })

  it('skips missed occurrences after the boundary date', () => {
    expect(nextRecurringDate('2026-10-01', 'daily', '2026-10-19')).toBe('2026-10-20')
    expect(nextRecurringDate('2026-10-01', 'weekly', '2026-10-19')).toBe('2026-10-22')
    expect(nextRecurringDate('2026-10-19', 'daily', '2026-10-19')).toBe('2026-10-20')
  })

  it('returns no next date for non-recurring tasks', () => {
    expect(nextRecurringDate('2026-10-19', 'none')).toBeNull()
  })
})
