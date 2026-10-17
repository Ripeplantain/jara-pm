<script setup lang="ts">
import { Check, Trash2 } from '@lucide/vue'
import type { Task, TaskStatus } from '#shared/types/domain'

const props = withDefaults(defineProps<{ task: Task, showReschedule?: boolean }>(), { showReschedule: false })
const emit = defineEmits<{ updated: [task: Task], deleted: [id: string] }>()
const localStatus = ref<TaskStatus>(props.task.status)
const localDueDate = ref(props.task.dueDate ?? '')
const isSaving = ref(false)

watch(() => props.task.status, value => { localStatus.value = value })
watch(() => props.task.dueDate, value => { localDueDate.value = value ?? '' })

const toggle = async () => {
  const previous = localStatus.value
  localStatus.value = previous === 'done' ? 'todo' : 'done'
  isSaving.value = true
  try {
    const task = await $fetch<Task>(`/api/tasks/${props.task.id}`, {
      method: 'PATCH', body: { status: localStatus.value },
    })
    emit('updated', task)
  } catch {
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
    emit('updated', task)
  } catch {
    localDueDate.value = props.task.dueDate ?? ''
  }
}

const remove = async () => {
  if (!window.confirm(`Delete “${props.task.title}”? This cannot be undone.`)) return
  await $fetch(`/api/tasks/${props.task.id}`, { method: 'DELETE' })
  emit('deleted', props.task.id)
}
</script>

<template>
  <div class="task-row">
    <button type="button" class="task-check" :class="{ done: localStatus === 'done' }" :disabled="isSaving" :aria-label="localStatus === 'done' ? `Reopen ${task.title}` : `Complete ${task.title}`" @click="toggle">
      <Check v-if="localStatus === 'done'" aria-hidden="true" />
    </button>
    <div class="task-copy">
      <span class="task-title" :class="{ done: localStatus === 'done' }">{{ task.title }}</span>
      <span class="task-meta">
        <span v-if="task.projectTitle">{{ task.projectTitle }}</span>
        <span v-if="task.milestoneTitle">· {{ task.milestoneTitle }}</span>
        <span v-if="task.dueDate">· Due {{ task.dueDate }}</span>
        <span v-if="task.priority !== 'none'" style="display:inline-flex;align-items:center;gap:5px">
          <span class="priority-dot" :class="task.priority" /> {{ task.priority }}
        </span>
      </span>
    </div>
    <div class="task-actions">
      <input v-if="showReschedule" v-model="localDueDate" type="date" class="date-input" :aria-label="`Reschedule ${task.title}`" @change="reschedule">
      <button type="button" class="button ghost small" :aria-label="`Delete ${task.title}`" @click="remove">
        <Trash2 :size="15" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>
