<script setup lang="ts">
import { Check, Trash2 } from '@lucide/vue'
import type { Task, TaskStatus, WorkspaceMember } from '#shared/types/domain'
import { estimateLabel, estimateOptions } from '#shared/utils/estimates'

const props = withDefaults(defineProps<{ task: Task, showReschedule?: boolean, members?: WorkspaceMember[] }>(), { showReschedule: false, members: () => [] })
const emit = defineEmits<{ updated: [task: Task], deleted: [id: string] }>()
const { capture, captureException } = useProductAnalytics()
const { showUndo, hideTask, revealTask } = useToasts()
const { refreshTaskViews } = useTaskViews()
const { activeWorkspace } = useWorkspaces()
// `scale === 'none'` hides estimates entirely, so the row shows nothing rather than a number
// with no scale to read it against.
const estimateScale = computed(() => activeWorkspace.value?.estimateScale ?? 'none')
const estimateText = computed(() => (
  estimateScale.value === 'none' ? null : estimateLabel(estimateScale.value, props.task.estimate)
))
const estimateChoices = computed(() => estimateOptions(estimateScale.value))
const localEstimate = ref(props.task.estimate === null ? '' : String(props.task.estimate))
watch(() => props.task.estimate, value => { localEstimate.value = value === null ? '' : String(value) })

// A stored estimate the current scale does not offer still has to be selectable, or saving any
// other field through this control would silently rewrite it.
const estimateOffScale = computed(() => (
  props.task.estimate !== null && !estimateChoices.value.some(option => option.value === props.task.estimate)
))

const setEstimate = async () => {
  const previous = props.task.estimate
  isSaving.value = true
  try {
    const task = await $fetch<Task>(`/api/tasks/${props.task.id}`, {
      method: 'PATCH',
      body: { estimate: localEstimate.value === '' ? null : Number(localEstimate.value) },
    })
    emit('updated', task)
  } catch (error: unknown) {
    captureException(error, { flow: 'task_estimate' })
    errorMessage.value = 'Kobi could not save that estimate.'
    localEstimate.value = previous === null ? '' : String(previous)
  } finally {
    isSaving.value = false
  }
}
const errorMessage = ref('')
const localStatus = ref<TaskStatus>(props.task.status)
const localDueDate = ref(props.task.dueDate ?? '')
const isSaving = ref(false)
const localAssigneeId = ref(props.task.assigneeId ?? '')

watch(() => props.task.status, value => { localStatus.value = value })
watch(() => props.task.dueDate, value => { localDueDate.value = value ?? '' })
watch(() => props.task.assigneeId, value => { localAssigneeId.value = value ?? '' })

const toggle = async () => {
  const previous = localStatus.value
  localStatus.value = previous === 'done' ? 'todo' : 'done'
  isSaving.value = true
  try {
    const task = await $fetch<Task>(`/api/tasks/${props.task.id}`, {
      method: 'PATCH', body: { status: localStatus.value },
    })
    void refreshTaskViews()
    capture(localStatus.value === 'done' ? 'task_action_completed' : 'task_action_reopened', {
      has_due_date: Boolean(task.dueDate),
    })
    emit('updated', task)
  } catch (error: unknown) {
    captureException(error, { flow: 'task_status_update' })
    errorMessage.value = 'Kobi could not save that change.'
    localStatus.value = previous
  } finally {
    isSaving.value = false
  }
}

const reschedule = async () => {
  try {
    const task = await $fetch<Task>(`/api/tasks/${props.task.id}`, {
      method: 'PATCH', body: { dueDate: localDueDate.value || null },
    })
    capture('task_action_rescheduled', { has_due_date: Boolean(task.dueDate) })
    emit('updated', task)
  } catch (error: unknown) {
    captureException(error, { flow: 'task_reschedule' })
    errorMessage.value = 'Kobi could not reschedule this task.'
    localDueDate.value = props.task.dueDate ?? ''
  }
}

// A reversible action in place of a confirmation prompt: the row leaves immediately and the
// DELETE only runs once the undo window closes, so taking it back costs no request at all.
const remove = () => {
  errorMessage.value = ''
  hideTask(props.task.id)
  capture('task_action_deleted')
  showUndo({
    message: `Deleted “${props.task.title}”`,
    flushOnNavigate: true,
    onCommit: async () => {
      await $fetch(`/api/tasks/${props.task.id}`, { method: 'DELETE' })
      emit('deleted', props.task.id)
      await refreshTaskViews()
    },
    onCommitError: (error: unknown) => {
      captureException(error, { flow: 'task_delete' })
      revealTask(props.task.id)
      errorMessage.value = 'Kobi could not delete this task.'
    },
    onUndo: () => revealTask(props.task.id),
  })
}

const pauseRecurrence = async () => {
  if (isSaving.value || props.task.recurrence === 'none') return
  isSaving.value = true
  try {
    const task = await $fetch<Task>(`/api/tasks/${props.task.id}`, {
      method: 'PATCH', body: { recurrence: 'none' },
    })
    capture('task_recurrence_paused')
    emit('updated', task)
  } catch (error: unknown) {
    captureException(error, { flow: 'task_recurrence_pause' })
  } finally {
    isSaving.value = false
  }
}

const assign = async () => {
  const previous = props.task.assigneeId
  isSaving.value = true
  try {
    const task = await $fetch<Task>(`/api/tasks/${props.task.id}`, {
      method: 'PATCH', body: { assigneeId: localAssigneeId.value || null },
    })
    emit('updated', task)
  } catch (error: unknown) {
    captureException(error, { flow: 'task_assignment' })
    localAssigneeId.value = previous ?? ''
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <div class="task-row" :class="{ 'is-done': localStatus === 'done' }">
    <button type="button" class="task-check" :class="{ done: localStatus === 'done' }" :disabled="isSaving" :aria-label="localStatus === 'done' ? `Reopen ${task.title}` : `Complete ${task.title}`" @click="toggle">
      <Check v-if="localStatus === 'done'" aria-hidden="true" />
    </button>
    <div class="task-copy">
      <span class="task-title" :class="{ done: localStatus === 'done' }">
        <span class="task-key">{{ task.key }}</span>
        {{ task.title }}
      </span>
      <span v-if="task.labels.length" class="task-labels">
        <LabelChip v-for="label in task.labels" :key="label.id" :label="label" />
      </span>
      <span class="task-meta">
        <span v-if="task.projectTitle">{{ task.projectTitle }}</span>
        <span v-if="task.milestoneTitle">· {{ task.milestoneTitle }}</span>
        <span v-if="task.dueDate">· Due {{ task.dueDate }}</span>
        <span v-if="task.recurrence !== 'none'">· Repeats {{ task.recurrence }}</span>
        <span v-if="task.priority !== 'none'" class="task-priority">
          <span class="priority-dot" :class="task.priority" /> {{ task.priority }}
        </span>
        <span v-if="task.assigneeName">· {{ task.assigneeName }}</span>
        <span v-if="estimateText" class="task-estimate">· {{ estimateText }}</span>
      </span>
    </div>
    <div class="task-actions">
      <select v-if="members.length && task.projectId" v-model="localAssigneeId" class="task-assignee" :aria-label="`Assign ${task.title}`" :disabled="isSaving" @change="assign">
        <option value="">Unassigned</option>
        <option v-for="member in members" :key="member.userId" :value="member.userId">{{ member.name }}</option>
      </select>
      <select
        v-if="estimateScale !== 'none'"
        v-model="localEstimate"
        class="task-assignee"
        :aria-label="`Estimate for ${task.title}`"
        :disabled="isSaving"
        @change="setEstimate"
      >
        <option value="">No estimate</option>
        <option v-for="option in estimateChoices" :key="option.value" :value="String(option.value)">{{ option.label }}</option>
        <option v-if="estimateOffScale" :value="String(task.estimate)">{{ task.estimate }}</option>
      </select>
      <LabelPicker :task="task" @updated="emit('updated', $event)" />
      <input v-if="showReschedule" v-model="localDueDate" type="date" class="date-input" :aria-label="`Reschedule ${task.title}`" @change="reschedule">
      <button v-if="task.recurrence !== 'none' && localStatus !== 'done'" type="button" class="button ghost small" :aria-label="`Pause repeating ${task.title}`" @click="pauseRecurrence">
        Pause
      </button>
      <button type="button" class="button ghost small" :aria-label="`Delete ${task.title}`" @click="remove">
        <Trash2 :size="15" aria-hidden="true" />
      </button>
    </div>
    <p v-if="errorMessage" class="task-error" role="alert">{{ errorMessage }}</p>
  </div>
</template>
