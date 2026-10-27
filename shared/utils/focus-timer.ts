export const DEFAULT_FOCUS_MINUTES = 25
export const MIN_FOCUS_MINUTES = 1
export const MAX_FOCUS_MINUTES = 180

/** The original Pomodoro-length suggestion used on first visit and for invalid stored values. */
export const FOCUS_SESSION_SECONDS = DEFAULT_FOCUS_MINUTES * 60

export const isFocusDurationMinutes = (value: unknown): value is number => (
  typeof value === 'number'
  && Number.isInteger(value)
  && value >= MIN_FOCUS_MINUTES
  && value <= MAX_FOCUS_MINUTES
)

/** Turns editable input into a supported whole-minute duration. */
export const normalizeFocusMinutes = (value: unknown, fallback = DEFAULT_FOCUS_MINUTES) => {
  const numeric = typeof value === 'string' && value.trim() === '' ? Number.NaN : Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(MAX_FOCUS_MINUTES, Math.max(MIN_FOCUS_MINUTES, Math.round(numeric)))
}

export const focusDurationSeconds = (minutes: number) => normalizeFocusMinutes(minutes) * 60

/** Formats whole seconds as mm:ss. Negative and fractional input is clamped and rounded up. */
export const formatTimer = (seconds: number) => {
  const total = Math.max(0, Math.ceil(Number.isFinite(seconds) ? seconds : 0))
  const minutes = Math.floor(total / 60)
  return `${String(minutes).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** Whole seconds left before `endsAt` (epoch ms), never below zero. */
export const secondsRemaining = (endsAt: number, now: number) => Math.max(0, Math.ceil((endsAt - now) / 1000))
