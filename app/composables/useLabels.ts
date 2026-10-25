import type { Label, LabelCollection, Task } from '#shared/types/domain'
import { getUserFacingErrorMessage } from '#shared/utils/error-message'

const emptyCollection = (): LabelCollection => ({ groups: [], labels: [] })

/**
 * The workspace's label set, fetched once under a shared key so every picker on a page reads
 * the same cache entry rather than refetching per row.
 *
 * Archived labels are not requested: they stay attached to the tasks that carry them, which
 * hydrate their own labels, but they must not appear in a picker.
 */
export const useLabels = () => {
  const request = useFetch<LabelCollection>('/api/labels', {
    key: 'label-collection',
    default: emptyCollection,
  })

  const groups = computed(() => request.data.value.groups)
  const labels = computed(() => request.data.value.labels)

  const ungrouped = computed(() => labels.value.filter(label => label.groupId === null))
  const inGroup = (groupId: string) => labels.value.filter(label => label.groupId === groupId)

  // Grouped labels are single-select, so the picker needs to know which group a label belongs
  // to in order to describe the swap it is about to make.
  const groupNameFor = (label: Label) => groups.value.find(group => group.id === label.groupId)?.name ?? null

  const attach = (taskId: string, labelId: string) =>
    $fetch<Task>(`/api/tasks/${taskId}/labels`, { method: 'POST', body: { labelId } })

  const detach = (taskId: string, labelId: string) =>
    $fetch<Task>(`/api/tasks/${taskId}/labels/${labelId}`, { method: 'DELETE' })

  const createLabel = async (body: { name: string, color: Label['color'], groupId: string | null }) => {
    const label = await $fetch<Label>('/api/labels', { method: 'POST', body })
    await request.refresh()
    return label
  }

  const createGroup = async (name: string) => {
    const group = await $fetch<{ id: string, name: string, position: number }>('/api/labels/groups', {
      method: 'POST',
      body: { name },
    })
    await request.refresh()
    return group
  }

  const updateLabel = async (id: string, body: Record<string, unknown>) => {
    const label = await $fetch<Label>(`/api/labels/${id}`, { method: 'PATCH', body })
    await request.refresh()
    return label
  }

  const removeLabel = async (id: string) => {
    await $fetch(`/api/labels/${id}`, { method: 'DELETE' })
    await request.refresh()
  }

  return {
    ...request,
    groups,
    labels,
    ungrouped,
    inGroup,
    groupNameFor,
    attach,
    detach,
    createLabel,
    createGroup,
    updateLabel,
    removeLabel,
    errorMessageFor: (error: unknown, fallback: string) => getUserFacingErrorMessage(error, fallback),
  }
}
