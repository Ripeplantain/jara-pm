import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FOCUS_MINUTES,
  FOCUS_SESSION_SECONDS,
  focusDurationSeconds,
  formatTimer,
  isFocusDurationMinutes,
  MAX_FOCUS_MINUTES,
  MIN_FOCUS_MINUTES,
  normalizeFocusMinutes,
  secondsRemaining,
} from '../shared/utils/focus-timer'

describe('focus timer helpers', () => {
  it('keeps 25 minutes as the first-use suggestion', () => {
    expect(DEFAULT_FOCUS_MINUTES).toBe(25)
    expect(formatTimer(FOCUS_SESSION_SECONDS)).toBe('25:00')
  })

  it('accepts only supported whole-minute durations', () => {
    expect(MIN_FOCUS_MINUTES).toBe(1)
    expect(MAX_FOCUS_MINUTES).toBe(180)
    expect(isFocusDurationMinutes(1)).toBe(true)
    expect(isFocusDurationMinutes(180)).toBe(true)
    expect(isFocusDurationMinutes(0)).toBe(false)
    expect(isFocusDurationMinutes(181)).toBe(false)
    expect(isFocusDurationMinutes(25.5)).toBe(false)
    expect(isFocusDurationMinutes('25')).toBe(false)
  })

  it('normalizes editable input and safely falls back', () => {
    expect(normalizeFocusMinutes('45')).toBe(45)
    expect(normalizeFocusMinutes('24.4')).toBe(24)
    expect(normalizeFocusMinutes('24.5')).toBe(25)
    expect(normalizeFocusMinutes(0)).toBe(1)
    expect(normalizeFocusMinutes(999)).toBe(180)
    expect(normalizeFocusMinutes('')).toBe(25)
    expect(normalizeFocusMinutes('not a duration')).toBe(25)
    expect(normalizeFocusMinutes(Number.NaN, 50)).toBe(50)
  })

  it('converts a selected duration to countdown seconds', () => {
    expect(focusDurationSeconds(1)).toBe(60)
    expect(focusDurationSeconds(45)).toBe(2_700)
    expect(focusDurationSeconds(180)).toBe(10_800)
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
