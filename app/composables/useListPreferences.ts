/**
 * Per-list view options, such as whether a list reveals completed or archived items. Each list
 * remembers its own setting, the way a platform list app does, so turning one on does not change
 * every other screen.
 *
 * Persistence mirrors useTheme: a localStorage mirror of shared state, every access guarded,
 * because storage can be unavailable or hold values written by an older build.
 */
const STORAGE_KEY = 'kobi-list-preferences'

export type ListPreferenceKey =
  | 'inbox.showCompleted'
  | 'upcoming.showCompleted'
  | 'today.showCompleted'
  | 'project.showCompleted'
  | 'projects.showArchived'
  | 'goals.showArchived'

export const useListPreferences = () => {
  const preferences = useState<Partial<Record<ListPreferenceKey, boolean>>>('kobi-list-preferences', () => ({}))

  const persist = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences.value))
    } catch {
      // A private window or blocked storage must not break the toggle itself.
    }
  }

  const initialize = () => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (!stored) return
      const parsed = JSON.parse(stored) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        // Only the booleans are taken, so an unknown or stale shape cannot poison the state.
        const entries = Object.entries(parsed).filter(([, value]) => typeof value === 'boolean')
        preferences.value = { ...preferences.value, ...Object.fromEntries(entries) }
      }
    } catch {
      // Unreadable or invalid storage leaves the defaults in place.
    }
  }

  const isEnabled = (key: ListPreferenceKey) => preferences.value[key] === true

  const toggle = (key: ListPreferenceKey) => {
    preferences.value = { ...preferences.value, [key]: !isEnabled(key) }
    persist()
  }

  return { preferences, initialize, isEnabled, toggle }
}
