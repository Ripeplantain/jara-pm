<script setup lang="ts">
import { ArrowUp, ChevronDown, ChevronUp, Sparkles } from '@lucide/vue'
import type { Project, TaskPriority, TaskRecurrence } from '#shared/types/domain'
import { getUserFacingErrorMessage } from '#shared/utils/error-message'

const props = withDefaults(defineProps<{
  defaultProjectId?: string | null
  defaultMilestoneId?: string | null
  placeholder?: string
}>(), {
  defaultProjectId: null,
  defaultMilestoneId: null,
  placeholder: 'Add a task or ask Kobi…',
})

const emit = defineEmits<{ created: [], ask: [message: string] }>()
const { capture, captureException } = useProductAnalytics()
const title = ref('')
const projectId = ref<string | null>(props.defaultProjectId)
const milestoneId = ref<string | null>(props.defaultMilestoneId)
const dueDate = ref<string | null>(null)
const priority = ref<TaskPriority>('none')
const recurrence = ref<TaskRecurrence>('none')
const isExpanded = ref(false)
const isSaving = ref(false)
const errorMessage = ref('')

const { data: projects } = await useFetch<Project[]>('/api/projects', {
  key: 'quick-capture-projects',
  default: () => [],
  lazy: true,
})

const selectedProject = computed(() => projects.value.find(project => project.id === projectId.value))
const canCreate = computed(() => Boolean(title.value.trim()) && (recurrence.value === 'none' || Boolean(dueDate.value)))

watch(projectId, () => {
  if (!selectedProject.value?.milestones.some(item => item.id === milestoneId.value)) milestoneId.value = null
})

const create = async () => {
  if (!canCreate.value || isSaving.value) return
  isSaving.value = true
  errorMessage.value = ''
  try {
    await $fetch('/api/tasks', {
      method: 'POST',
      body: {
        title: title.value,
        projectId: projectId.value,
        milestoneId: milestoneId.value,
        dueDate: dueDate.value || null,
        priority: priority.value,
        recurrence: recurrence.value,
      },
    })
    const capturedDueDate = Boolean(dueDate.value)
    const capturedPriority = priority.value
    const capturedRecurrence = recurrence.value
    title.value = ''
    dueDate.value = null
    priority.value = 'none'
    recurrence.value = 'none'
    capture('task_capture_submitted', {
      has_project: Boolean(projectId.value),
      has_due_date: capturedDueDate,
      priority: capturedPriority,
      recurrence: capturedRecurrence,
    })
    emit('created')
  } catch (error: unknown) {
    captureException(error, { flow: 'task_capture' })
    errorMessage.value = getUserFacingErrorMessage(error, 'Could not create the task.', {
      validation: 'Please check the task details and try again.',
      unprocessable: 'That project or milestone is no longer available. Refresh and try again.',
      unavailable: 'We could not create the task right now. Please try again in a moment.',
    })
  } finally {
    isSaving.value = false
  }
}

const ask = () => {
  if (!title.value.trim()) return
  capture('ask_kobi_opened', { source: 'quick_capture' })
  emit('ask', title.value.trim())
  title.value = ''
}
</script>

<template>
  <form class="quick-capture" @submit.prevent="create">
    <div class="capture-main">
      <input v-model="title" :placeholder="placeholder" aria-label="Task title or question for Kobi">
      <button type="button" class="button secondary small" :disabled="!title.trim()" @click="ask">
        <Sparkles :size="15" aria-hidden="true" /> Ask
      </button>
      <button type="submit" class="button small" :disabled="!canCreate || isSaving" aria-label="Add task">
        <ArrowUp :size="16" aria-hidden="true" />
      </button>
    </div>
    <div v-if="isExpanded" class="capture-options">
      <label class="field">
        <span class="field-label">Project</span>
        <select v-model="projectId" class="select">
          <option :value="null">Inbox</option>
          <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.title }}</option>
        </select>
      </label>
      <label class="field">
        <span class="field-label">Due date</span>
        <input v-model="dueDate" type="date" class="input">
      </label>
      <label class="field">
        <span class="field-label">Priority</span>
        <select v-model="priority" class="select">
          <option value="none">No priority</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </label>
      <label class="field">
        <span class="field-label">Repeats</span>
        <select v-model="recurrence" class="select">
          <option value="none">Does not repeat</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
        </select>
      </label>
      <label v-if="selectedProject?.milestones.length" class="field">
        <span class="field-label">Milestone</span>
        <select v-model="milestoneId" class="select">
          <option :value="null">No milestone</option>
          <option v-for="milestone in selectedProject.milestones" :key="milestone.id" :value="milestone.id">{{ milestone.title }}</option>
        </select>
      </label>
    </div>
    <div class="capture-footer">
      <button type="button" class="capture-toggle" @click="isExpanded = !isExpanded">
        <component :is="isExpanded ? ChevronUp : ChevronDown" :size="14" aria-hidden="true" />
        {{ isExpanded ? 'Fewer details' : 'Add details' }}
      </button>
      <span v-if="errorMessage" class="form-error" role="alert">{{ errorMessage }}</span>
      <span v-else class="form-hint">{{ recurrence !== 'none' && !dueDate ? 'Choose a due date for recurring tasks' : 'Press Enter to add' }}</span>
    </div>
  </form>
</template>
