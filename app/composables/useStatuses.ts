import type { Status, StatusCategory } from '#shared/types/domain'

const emptyStatuses = (): Status[] => []

/**
 * The workspace's workflow, fetched once under a shared key so every row, board and command
 * reads the same cache entry. The server returns it ordered by position.
 *
 * Behaviour is keyed on `category`, never on `name`: a team can rename "Done" to "Shipped" and
 * completion must keep meaning the same thing.
 */
export const useStatuses = () => {
  const request = useFetch<Status[]>('/api/statuses', {
    key: 'workspace-statuses',
    default: emptyStatuses,
    dedupe: 'defer',
  })

  const statuses = computed(() => request.data.value)
  const defaultStatus = computed(() => statuses.value.find(status => status.isDefault) ?? null)
  const firstOfCategory = (category: StatusCategory) =>
    statuses.value.find(status => status.category === category) ?? null
  /** What a "mark done" toggle moves a task to: the lowest-position completed status. */
  const completedStatus = computed(() => firstOfCategory('completed'))
  const isCompleted = (status: Status) => status.category === 'completed'
  const isClosed = (status: Status) => status.category === 'completed' || status.category === 'canceled'

  const createStatus = async (body: { name: string, category: StatusCategory }) => {
    const status = await $fetch<Status>('/api/statuses', { method: 'POST', body })
    await request.refresh()
    return status
  }

  const renameStatus = async (id: string, name: string) => {
    const status = await $fetch<Status>(`/api/statuses/${id}`, { method: 'PATCH', body: { name } })
    await refreshNuxtData()
    return status
  }

  // `position` and `isDefault` are embedded in every task's nested status, and task lists are
  // sorted by position server-side, so both of these invalidate task caches too -- the same
  // reason `renameStatus` does.
  const setDefaultStatus = async (id: string) => {
    const status = await $fetch<Status>(`/api/statuses/${id}`, { method: 'PATCH', body: { isDefault: true } })
    await refreshNuxtData()
    return status
  }

  const reorderStatuses = async (statusIds: string[]) => {
    await $fetch<Status[]>('/api/statuses/reorder', { method: 'POST', body: { statusIds } })
    await refreshNuxtData()
  }

  const deleteStatus = async (id: string, replacementStatusId?: string) => {
    await $fetch(`/api/statuses/${id}`, { method: 'DELETE', query: { replacementStatusId } })
    // Reassigned tasks changed status in every list, not only this one.
    await refreshNuxtData()
  }

  return {
    ...request,
    createStatus,
    renameStatus,
    setDefaultStatus,
    reorderStatuses,
    deleteStatus,
    statuses,
    defaultStatus,
    completedStatus,
    firstOfCategory,
    isCompleted,
    isClosed,
  }
}
