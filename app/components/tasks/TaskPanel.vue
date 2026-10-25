<script setup lang="ts">
import { X } from '@lucide/vue'
import type { Task, TaskPriority, TaskStatus, WorkspaceMember } from '#shared/types/domain'
import { estimateOptions } from '#shared/utils/estimates'

const { openKey, close } = useTaskPanel()
const { patch, decorate, adopt } = useOptimisticTask()
const { registerTaskView } = useTaskViews()
const { focus: focusTask, blur: blurTask } = useFocusedTask()
const { activeWorkspace } = useWorkspaces()
const { capture } = useProductAnalytics()
const { isCompact } = useCompactViewport()

// Keyed by the task key, so opening a different task refetches while the panel stays mounted.
const { data: fetched, status, error, refresh } = useFetch<Task>(
  () => `/api/tasks/by-key/${openKey.value}`,
  {
    key: () => `task-panel-${openKey.value}`,
    // `openKey` is null only while the panel is closed, and the panel is not rendered then.
    immediate: Boolean(openKey.value),
    watch: [openKey],
  },
)

const task = computed(() => (fetched.value ? decorate(fetched.value) : null))

// The panel's cache keys contain the task key, so they cannot be listed in `TASK_VIEW_KEYS`.
// Registering them is what stops an edit made here reverting: the overlay drops a change once
// the surfaces showing it have refreshed, and this panel is one of those surfaces.
registerTaskView(() => refresh())

// Opening the panel is also a focus: the palette's task actions should apply to what is on
// screen without the person having to hover a row first.
watch(task, (value) => { if (value) focusTask(value) }, { immediate: true })

const { data: members } = useFetch<WorkspaceMember[]>('/api/workspace/members', {
  key: 'workspace-members-task-list',
  default: (): WorkspaceMember[] => [],
  lazy: true,
})

const taskId = computed(() => fetched.value?.id ?? null)
const parentId = computed(() => fetched.value?.parentId ?? null)

// Both of these fetch only once there is really something to fetch. Left to `watch`, they fired
// as the ids passed through `undefined` and `null`: the subtask query would omit `parentId`
// altogether -- which the schema reads as "no filter", returning every task in the workspace --
// and the parent request would ask for `/api/tasks/null` and 400.
const { data: subtasks, execute: loadSubtasks } = useFetch<Task[]>('/api/tasks', {
  key: () => `task-panel-subtasks-${taskId.value ?? 'none'}`,
  query: computed(() => ({ scope: 'all', includeCompleted: 'true', parentId: taskId.value })),
  default: (): Task[] => [],
  immediate: false,
  watch: false,
})

const { data: parent, execute: loadParent } = useFetch<Task | null>(
  () => `/api/tasks/${parentId.value}`,
  {
    key: () => `task-panel-parent-${parentId.value ?? 'none'}`,
    default: () => null,
    immediate: false,
    watch: false,
  },
)

watch(taskId, (id) => {
  subtasks.value = []
  if (id) void loadSubtasks()
}, { immediate: true })

watch(parentId, (id) => {
  parent.value = null
  if (id) void loadParent()
}, { immediate: true })

registerTaskView(() => (taskId.value ? loadSubtasks() : undefined))

const estimateScale = computed(() => activeWorkspace.value?.estimateScale ?? 'none')
const estimateChoices = computed(() => estimateOptions(estimateScale.value))
const estimateOffScale = computed(() => {
  const value = task.value?.estimate
  return value !== null && value !== undefined && !estimateChoices.value.some(option => option.value === value)
})

const STATUSES: ReadonlyArray<{ value: TaskStatus, label: string }> = [
  { value: 'todo', label: 'To do' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
]
const PRIORITIES: ReadonlyArray<{ value: TaskPriority, label: string }> = [
  { value: 'none', label: 'No priority' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
]

const apply = async (changes: Parameters<typeof patch>[1], flow: string) => {
  if (!task.value) return
  await patch(task.value, changes, { flow })
}

const onSelect = (field: 'status' | 'priority') => (event: Event) => {
  const value = (event.target as HTMLSelectElement).value
  void apply({ [field]: value } as Parameters<typeof patch>[1], `panel_task_${field}`)
}

const onAssign = (event: Event) => {
  const value = (event.target as HTMLSelectElement).value
  void apply({ assigneeId: value || null }, 'panel_task_assignment')
}

const onEstimate = (event: Event) => {
  const value = (event.target as HTMLSelectElement).value
  void apply({ estimate: value === '' ? null : Number(value) }, 'panel_task_estimate')
}

const onDate = (field: 'dueDate' | 'scheduledFor') => (event: Event) => {
  const value = (event.target as HTMLInputElement).value
  void apply({ [field]: value || null } as Parameters<typeof patch>[1], `panel_task_${field}`)
}

const openParent = async () => {
  const key = parent.value?.key
  if (!key) return
  await close()
  await navigateTo(`/${key}`)
}

const panel = ref<HTMLElement | null>(null)

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Keeps Tab inside the panel while it covers the screen. Above the breakpoint there is no trap
 * at all: the list beside the panel is meant to be reachable, and trapping focus there would
 * make a side panel behave like a modal.
 */
const trapFocus = (event: KeyboardEvent) => {
  const container = panel.value
  if (!container) return
  const focusable = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)]
    .filter(element => element.offsetParent !== null)
  if (focusable.length === 0) {
    event.preventDefault()
    container.focus()
    return
  }
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const active = document.activeElement

  if (event.shiftKey && (active === first || active === container)) {
    event.preventDefault()
    last?.focus()
    return
  }
  if (!event.shiftKey && active === last) {
    event.preventDefault()
    first?.focus()
  }
}

// Escape closes, but only when the focus is inside the panel: the list behind stays live, and a
// person typing in the list must not have their Escape swallowed by a panel they are not in.
const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Tab' && isCompact.value) {
    trapFocus(event)
    return
  }
  if (event.key !== 'Escape') return
  event.stopPropagation()
  void close()
}

// Returning focus is only owed when the panel took it away, which is the modal case.
let previouslyFocused: HTMLElement | null = null
onBeforeUnmount(() => {
  if (isCompact.value) previouslyFocused?.focus()
})

// The palette offers actions for the focused task, so a closed panel must not leave one behind.
onBeforeUnmount(() => blurTask(taskId.value ?? undefined))

onMounted(() => {
  capture('task_panel_opened')
  previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
  // Focus the panel itself rather than the first control: it should be reachable by keyboard
  // immediately without hijacking the person's place in a form.
  panel.value?.focus()
})
</script>

<template>
  <!--
    On a wide screen this is deliberately not a dialog: it is a side panel, so the list beside it
    stays scrollable, clickable and focusable the whole time it is open, and there is no overlay
    and no focus trap.
    Below the breakpoint the same panel covers the entire screen, where all of that stops being
    true -- so there it becomes a real dialog, traps Tab, and the layout marks everything behind
    it `inert`. The alternative is content that is invisible but still reachable.
  -->
  <aside
    ref="panel"
    class="task-panel"
    :role="isCompact ? 'dialog' : undefined"
    :aria-modal="isCompact ? 'true' : undefined"
    tabindex="-1"
    :aria-label="task ? `${task.key} ${task.title}` : 'Task detail'"
    @keydown="onKeydown"
  >
    <header class="task-panel-header">
      <span class="task-key">{{ task?.key ?? openKey }}</span>
      <button type="button" class="button ghost small" aria-label="Close task detail" @click="close()">
        <X :size="16" aria-hidden="true" />
      </button>
    </header>

    <LoadingState v-if="status === 'pending' && !task" />
    <ErrorState
      v-else-if="error"
      :message="`Nothing in this workspace is numbered ${openKey}.`"
      @retry="refresh"
    />

    <div v-else-if="task" class="task-panel-body">
      <h2 class="task-panel-title" :class="{ done: task.status === 'done' }">{{ task.title }}</h2>
      <p v-if="task.description" class="task-panel-description"><TaskText :text="task.description" /></p>

      <div v-if="parent" class="task-panel-relation">
        <span class="field-label">Parent</span>
        <button type="button" class="task-title-button" @click="openParent">
          <span class="task-key">{{ parent.key }}</span> {{ parent.title }}
        </button>
      </div>

      <dl class="task-panel-fields">
        <div class="task-panel-field">
          <dt><label :for="`panel-status-${task.id}`">Status</label></dt>
          <dd>
            <select :id="`panel-status-${task.id}`" class="task-assignee" :value="task.status" @change="onSelect('status')">
              <option v-for="option in STATUSES" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
          </dd>
        </div>

        <div class="task-panel-field">
          <dt><label :for="`panel-priority-${task.id}`">Priority</label></dt>
          <dd>
            <select :id="`panel-priority-${task.id}`" class="task-assignee" :value="task.priority" @change="onSelect('priority')">
              <option v-for="option in PRIORITIES" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
          </dd>
        </div>

        <div v-if="members.length && task.projectId" class="task-panel-field">
          <dt><label :for="`panel-assignee-${task.id}`">Assignee</label></dt>
          <dd>
            <select :id="`panel-assignee-${task.id}`" class="task-assignee" :value="task.assigneeId ?? ''" @change="onAssign">
              <option value="">Unassigned</option>
              <option v-for="member in members" :key="member.userId" :value="member.userId">{{ member.name }}</option>
            </select>
          </dd>
        </div>

        <div class="task-panel-field">
          <dt><label :for="`panel-due-${task.id}`">Due</label></dt>
          <dd><input :id="`panel-due-${task.id}`" type="date" class="date-input" :value="task.dueDate ?? ''" @change="onDate('dueDate')"></dd>
        </div>

        <div class="task-panel-field">
          <dt><label :for="`panel-scheduled-${task.id}`">Scheduled</label></dt>
          <dd><input :id="`panel-scheduled-${task.id}`" type="date" class="date-input" :value="task.scheduledFor ?? ''" @change="onDate('scheduledFor')"></dd>
        </div>

        <div v-if="estimateScale !== 'none'" class="task-panel-field">
          <dt><label :for="`panel-estimate-${task.id}`">Estimate</label></dt>
          <dd>
            <select :id="`panel-estimate-${task.id}`" class="task-assignee" :value="task.estimate === null ? '' : String(task.estimate)" @change="onEstimate">
              <option value="">No estimate</option>
              <option v-for="option in estimateChoices" :key="option.value" :value="String(option.value)">{{ option.label }}</option>
              <option v-if="estimateOffScale" :value="String(task.estimate)">{{ task.estimate }}</option>
            </select>
          </dd>
        </div>

        <div v-if="task.projectTitle" class="task-panel-field">
          <dt>Project</dt>
          <dd>{{ task.projectTitle }}<template v-if="task.milestoneTitle"> · {{ task.milestoneTitle }}</template></dd>
        </div>
      </dl>

      <div class="task-panel-field">
        <span class="field-label">Labels</span>
        <div class="task-panel-labels">
          <LabelChip v-for="label in task.labels" :key="label.id" :label="label" />
          <LabelPicker :task="task" @updated="adopt" />
        </div>
      </div>

      <section v-if="subtasks.length" class="task-panel-section">
        <h3>Subtasks <span class="form-hint">{{ subtasks.filter(item => item.status === 'done').length }} of {{ subtasks.length }} done</span></h3>
        <TaskList :tasks="subtasks" />
      </section>
    </div>
  </aside>
</template>
