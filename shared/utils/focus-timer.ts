/** Length of one focus session, in seconds. */
export const FOCUS_SESSION_SECONDS = 25 * 60

/** Formats whole seconds as mm:ss. Negative and fractional input is clamped and rounded up. */
export const formatTimer = (seconds: number) => {
  const total = Math.max(0, Math.ceil(Number.isFinite(seconds) ? seconds : 0))
  const minutes = Math.floor(total / 60)
  return `${String(minutes).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** Whole seconds left before `endsAt` (epoch ms), never below zero. */
export const secondsRemaining = (endsAt: number, now: number) => Math.max(0, Math.ceil((endsAt - now) / 1000))
