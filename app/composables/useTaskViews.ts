// Each task view owns its own useFetch cache entry, so completing a task on one screen used to
// leave the others showing stale counts until a manual reload. These are the keys that list
// tasks; a detail page refreshes itself through the `changed` event instead.
const TASK_VIEW_KEYS = ['today-dashboard', 'inbox-tasks', 'upcoming-tasks', 'board-tasks'] as const

/**
 * Surfaces that render tasks from a cache key of their own -- the task panel and its subtask
 * list, whose keys contain the task key and so cannot be listed above.
 *
 * This matters more than it looks. The optimistic overlay drops a pending change once the
 * surfaces showing it have been refreshed, so a surface that is not refreshed here would revert
 * to its own stale row the moment the overlay cleared, undoing an edit the server had accepted.
 *
 * Module scope rather than `useState`: these are callbacks, which cannot be serialized into the
 * SSR payload, and registration is per-document.
 */
const extraRefreshers = new Set<() => unknown>()

export const useTaskViews = () => {
  /**
   * Registers a refresh callback for as long as the calling component is alive, so a panel that
   * has closed is not refreshed on every later mutation.
   */
  const registerTaskView = (refresh: () => unknown) => {
    if (!import.meta.client) return
    extraRefreshers.add(refresh)
    onScopeDispose(() => extraRefreshers.delete(refresh))
  }

  const refreshTaskViews = async () => {
    await Promise.all([
      refreshNuxtData([...TASK_VIEW_KEYS]),
      ...[...extraRefreshers].map(refresh => Promise.resolve(refresh()).catch(() => {
        // One stale surface must not stop the others from refreshing, and a failed refresh is
        // not a failed mutation -- the write already succeeded.
      })),
    ])
  }

  return { refreshTaskViews, registerTaskView }
}
