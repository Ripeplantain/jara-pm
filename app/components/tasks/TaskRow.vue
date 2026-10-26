<script setup lang="ts">
import { Check, Trash2 } from '@lucide/vue'
import type { Status, Task, TaskPriority, WorkspaceMember } from '#shared/types/domain'
import { estimateLabel, estimateOptions } from '#shared/utils/estimates'

const props = withDefaults(defineProps<{ task: Task, showReschedule?: boolean, enableTriage?: boolean, members?: WorkspaceMember[] }>(), { showReschedule: false, enableTriage: false, members: () => [] })
const emit = defineEmits<{ updated: [task: Task], deleted: [id: string] }>()
const { capture, captureException } = useProductAnalytics()
const { showUndo, hideTask, revealTask } = useToasts()
const { refreshTaskViews } = useTaskViews()
const { activeWorkspace } = useWorkspaces()
const { patch, decorate, adopt } = useOptimisticTask()
const { focus: focusTask, isFocused } = useFocusedTask()
const { openTask } = useTaskPanel()
const { statuses, defaultStatus, completedStatus } = useStatuses()

// Everything the row renders comes from the decorated task, so a pending change shows here the
// moment it is made and rolls back on its own if the request fails. There are no local mirrors
// of server fields left to drift.
const current = computed(() => decorate(props.task))

// `scale === 'none'` hides estimates entirely, so the row shows nothing rather than a number
// with no scale to read it against.
const estimateScale = computed(() => activeWorkspace.value?.estimateScale ?? 'none')
const estimateText = computed(() => (
  estimateScale.value === 'none' ? null : estimateLabel(estimateScale.value, current.value.estimate)
))
const estimateChoices = computed(() => estimateOptions(estimateScale.value))

// A stored estimate the current scale does not offer still has to be selectable, or saving any
// other field through this control would silently rewrite it.
const estimateOffScale = computed(() => (
  current.value.estimate !== null && !estimateChoices.value.some(option => option.value === current.value.estimate)
))

// Completion is a property of the status category, never of its name: a renamed "Done" still
// completes, and "Canceled" does not.
const isDone = computed(() => current.value.status.category === 'completed')

const assigneeSelect = ref<HTMLSelectElement | null>(null)
const estimateSelect = ref<HTMLSelectElement | null>(null)
const dueInput = ref<HTMLInputElement | null>(null)
const labelPicker = ref<{ open: () => void } | null>(null)

const toggle = async () => {
  // Completing targets the lowest-position completed status; reopening returns the task to the
  // workspace default rather than remembering where it was.
  const status = isDone.value ? defaultStatus.value : completedStatus.value
  if (!status) return
  const task = await patch(current.value, { status }, {
    flow: 'task_status_update',
    message: 'Kobi could not save that change.',
  })
  if (!task) return
  capture(status.category === 'completed' ? 'task_action_completed' : 'task_action_reopened', {
    has_due_date: Boolean(task.dueDate),
  })
  emit('updated', task)
}

const setStatus = async (status: Status) => {
  const task = await patch(current.value, { status }, { flow: 'task_status_update' })
  if (task) emit('updated', task)
}

const setPriority = async (priority: TaskPriority) => {
  const task = await patch(current.value, { priority }, { flow: 'task_priority' })
  if (task) emit('updated', task)
}

const setEstimate = async (event: Event) => {
  const value = (event.target as HTMLSelectElement).value
  const task = await patch(current.value, { estimate: value === '' ? null : Number(value) }, {
    flow: 'task_estimate',
    message: 'Kobi could not save that estimate.',
  })
  if (task) emit('updated', task)
}

const assign = async (event: Event) => {
  const value = (event.target as HTMLSelectElement).value
  const task = await patch(current.value, { assigneeId: value || null }, { flow: 'task_assignment' })
  if (task) emit('updated', task)
}

const reschedule = async (event: Event) => {
  const value = (event.target as HTMLInputElement).value
  const task = await patch(current.value, { dueDate: value || null }, {
    flow: 'task_reschedule',
    message: 'Kobi could not reschedule this task.',
  })
  if (!task) return
  capture('task_action_rescheduled', { has_due_date: Boolean(task.dueDate) })
  emit('updated', task)
}

const pauseRecurrence = async () => {
  if (current.value.recurrence === 'none') return
  const task = await patch(current.value, { recurrence: 'none' }, { flow: 'task_recurrence_pause' })
  if (!task) return
  capture('task_recurrence_paused')
  emit('updated', task)
}

// A reversible action in place of a confirmation prompt: the row leaves immediately and the
// DELETE only runs once the undo window closes, so taking it back costs no request at all.
const remove = () => {
  hideTask(props.task.id)
  capture('task_action_deleted')
  showUndo({
    message: `Deleted “${current.value.title}”`,
    flushOnNavigate: true,
    onCommit: async () => {
      await $fetch(`/api/tasks/${props.task.id}`, { method: 'DELETE' })
      emit('deleted', props.task.id)
      await refreshTaskViews()
    },
    onCommitError: (error: unknown) => {
      captureException(error, { flow: 'task_delete' })
      revealTask(props.task.id)
    },
    onUndo: () => revealTask(props.task.id),
  })
}

const onLabelUpdated = (task: Task) => {
  // The label endpoints return the whole task, so the result is shared with every other list
  // rather than only the row that was clicked.
  void adopt(task)
  emit('updated', task)
}

const PRIORITY_ORDER: readonly TaskPriority[] = ['none', 'low', 'medium', 'high']

const advance = <T,>(order: readonly T[], value: T): T => order[(order.indexOf(value) + 1) % order.length] as T

// The `s` key walks the workspace's own workflow in position order, skipping `canceled`:
// cancelling is a decision, not somewhere to land by pressing a key one time too many. A task
// already sitting in a canceled status can still advance out of it.
const nextStatus = (): Status | null => {
  const order = statuses.value.filter(
    status => status.category !== 'canceled' || status.id === current.value.status.id,
  )
  if (order.length === 0) return null
  const index = order.findIndex(status => status.id === current.value.status.id)
  return order[(index + 1) % order.length] ?? null
}

const changeStatus = async (event: Event) => {
  const status = statuses.value.find(item => item.id === (event.target as HTMLSelectElement).value)
  if (status) await setStatus(status)
}
/**
 * Single-key shortcuts on the focused row, which is why the row itself is focusable. They are
 * bound to the row rather than the document so only the row the person is on responds, and so
 * the list stays navigable with Tab alone.
 */
const onKeydown = (event: KeyboardEvent) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return
  // Only when the row itself holds focus. Anything inside it -- the date input, the selects, the
  // delete button -- owns its own keys, and `Enter` on a button must activate that button rather
  // than also opening the panel.
  if (event.target !== event.currentTarget) return

  // Each returns whether it did anything, so a key bound to a control this row does not render
  // -- no assignee select on an Inbox task, no estimate without a scale -- falls through to the
  // browser instead of being silently swallowed.
  const shortcuts: Record<string, () => boolean> = {
    s: () => {
      const next = nextStatus()
      if (!next) return false
      void setStatus(next)
      return true
    },
    p: () => { void setPriority(advance(PRIORITY_ORDER, current.value.priority)); return true },
    x: () => { void toggle(); return true },
    a: () => Boolean(assigneeSelect.value?.focus() ?? assigneeSelect.value),
    e: () => Boolean(estimateSelect.value?.focus() ?? estimateSelect.value),
    d: () => Boolean(dueInput.value?.focus() ?? dueInput.value),
    l: () => Boolean(labelPicker.value?.open() ?? labelPicker.value),
    Enter: () => { void openTask(current.value.key); return true },
  }

  const run = shortcuts[event.key]
  if (!run) return
  if (run()) event.preventDefault()
}
</script>

<template>
  <div
    class="task-row"
    :class="{ 'is-done': isDone, 'is-focused': isFocused(task.id) }"
    role="group"
    tabindex="0"
    :aria-label="current.title"
    @keydown="onKeydown"
    @focusin="focusTask(current)"
    @mouseenter="focusTask(current)"
  >
    <button type="button" class="task-check" :class="{ done: isDone }" :aria-label="isDone ? `Reopen ${current.title}` : `Complete ${current.title}`" @click="toggle">
      <Check v-if="isDone" aria-hidden="true" />
    </button>
    <div class="task-copy">
      <button type="button" class="task-title-button" :aria-label="`Open ${current.key}`" @click="openTask(current.key)">
        <span class="task-title" :class="{ done: isDone }">
          <span class="task-key">{{ current.key }}</span>
          {{ current.title }}
        </span>
      </button>
      <span v-if="current.labels.length" class="task-labels">
        <LabelChip v-for="label in current.labels" :key="label.id" :label="label" />
      </span>
      <span class="task-meta">
        <span v-if="current.projectTitle">{{ current.projectTitle }}</span>
        <span v-if="current.milestoneTitle">· {{ current.milestoneTitle }}</span>
        <span v-if="current.dueDate">· Due {{ current.dueDate }}</span>
        <span v-if="current.recurrence !== 'none'">· Repeats {{ current.recurrence }}</span>
        <PriorityMark v-if="current.priority !== 'none'" :priority="current.priority" />
        <span v-if="current.assigneeName">· {{ current.assigneeName }}</span>
        <span v-if="estimateText" class="task-estimate">· {{ estimateText }}</span>
      </span>
    </div>
    <div class="task-actions">
      <select
        v-if="statuses.length"
        :value="current.status.id"
        class="task-assignee"
        :aria-label="`Status for ${current.title}`"
        @change="changeStatus"
      >
        <option v-for="option in statuses" :key="option.id" :value="option.id">{{ option.name }}</option>
      </select>
      <select v-if="members.length && current.projectId" ref="assigneeSelect" :value="current.assigneeId ?? ''" class="task-assignee" :aria-label="`Assign ${current.title}`" @change="assign">
        <option value="">Unassigned</option>
        <option v-for="member in members" :key="member.userId" :value="member.userId">{{ member.name }}</option>
      </select>
      <select
        v-if="estimateScale !== 'none'"
        ref="estimateSelect"
        :value="current.estimate === null ? '' : String(current.estimate)"
        class="task-assignee"
        :aria-label="`Estimate for ${current.title}`"
        @change="setEstimate"
      >
        <option value="">No estimate</option>
        <option v-for="option in estimateChoices" :key="option.value" :value="String(option.value)">{{ option.label }}</option>
        <option v-if="estimateOffScale" :value="String(current.estimate)">{{ current.estimate }}</option>
      </select>
      <LabelPicker ref="labelPicker" :task="current" @updated="onLabelUpdated" />
      <input v-if="showReschedule" ref="dueInput" :value="current.dueDate ?? ''" type="date" class="date-input" :aria-label="`Reschedule ${current.title}`" @change="reschedule">
      <button v-if="current.recurrence !== 'none' && !isDone" type="button" class="button ghost small" :aria-label="`Pause repeating ${current.title}`" @click="pauseRecurrence">
        Pause
      </button>
      <button type="button" class="button ghost small" :aria-label="`Delete ${current.title}`" @click="remove">
        <Trash2 :size="15" aria-hidden="true" />
      </button>
    </div>
    <AiTriageProposalCard v-if="props.enableTriage" :task="current" @accepted="emit('updated', current)" />
  </div>
</template>
