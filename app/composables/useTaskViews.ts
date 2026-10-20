// Each task view owns its own useFetch cache entry, so completing a task on one screen used to
// leave the others showing stale counts until a manual reload. These are the keys that list
// tasks; a detail page refreshes itself through the `changed` event instead.
const TASK_VIEW_KEYS = ['today-dashboard', 'inbox-tasks', 'upcoming-tasks', 'board-tasks'] as const

export const useTaskViews = () => ({
  refreshTaskViews: () => refreshNuxtData([...TASK_VIEW_KEYS]),
})
