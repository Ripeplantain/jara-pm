import {
  DEFAULT_FOCUS_MINUTES,
  isFocusDurationMinutes,
  normalizeFocusMinutes,
} from '#shared/utils/focus-timer'

const STORAGE_KEY = 'kobi-focus-duration-minutes'

export const useFocusDuration = () => {
  const minutes = useState<number>('kobi-focus-duration-minutes', () => DEFAULT_FOCUS_MINUTES)

  const persist = () => {
    if (!import.meta.client) return
    try {
      localStorage.setItem(STORAGE_KEY, String(minutes.value))
    } catch {
      // Blocked or unavailable storage must not prevent the timer from being customized.
    }
  }

  const initialize = () => {
    if (!import.meta.client) return minutes.value
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored === null) return minutes.value
      const parsed = stored.trim() === '' ? Number.NaN : Number(stored)
      minutes.value = isFocusDurationMinutes(parsed) ? parsed : DEFAULT_FOCUS_MINUTES
    } catch {
      // Keep the in-memory choice when storage is unavailable.
    }
    return minutes.value
  }

  const setMinutes = (value: unknown) => {
    minutes.value = normalizeFocusMinutes(value, minutes.value)
    persist()
    return minutes.value
  }

  return { minutes: readonly(minutes), initialize, setMinutes }
}
