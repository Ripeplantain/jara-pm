import { describe, expect, it } from 'vitest'
import { FOCUS_SESSION_SECONDS, formatTimer, secondsRemaining } from '../shared/utils/focus-timer'

describe('focus timer helpers', () => {
  it('formats a full session as 25:00', () => {
    expect(formatTimer(FOCUS_SESSION_SECONDS)).toBe('25:00')
  })

  it('pads and clamps', () => {
    expect(formatTimer(65)).toBe('01:05')
    expect(formatTimer(0)).toBe('00:00')
    expect(formatTimer(-4)).toBe('00:00')
    expect(formatTimer(Number.NaN)).toBe('00:00')
    expect(formatTimer(59.2)).toBe('01:00')
  })

  it('computes remaining seconds from an end time', () => {
    expect(secondsRemaining(10_000, 0)).toBe(10)
    expect(secondsRemaining(10_000, 9_001)).toBe(1)
    expect(secondsRemaining(10_000, 12_000)).toBe(0)
  })
})
