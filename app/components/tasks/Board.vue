<script setup lang="ts">
import type { Task, TaskStatus } from '#shared/types/domain'

const props = defineProps<{ tasks: Task[] }>()
const emit = defineEmits<{ changed: [task: Task] }>()
const { captureException } = useProductAnalytics()
const { refreshTaskViews } = useTaskViews()

const columns: ReadonlyArray<{ status: TaskStatus, label: string, emptyMessage: string }> = [
  { status: 'todo', label: 'To do', emptyMessage: 'No tasks waiting to start.' },
  { status: 'in_progress', label: 'In progress', emptyMessage: 'No tasks are in progress.' },
  { status: 'done', label: 'Done', emptyMessage: 'No completed tasks yet.' },
]
const draggedTaskId = ref<string | null>(null)
const updatingTaskIds = ref<string[]>([])
const errorMessage = ref('')

const tasksFor = (status: TaskStatus) => props.tasks.filter(task => task.status === status)
const isUpdating = (taskId: string) => updatingTaskIds.value.includes(taskId)

const moveTask = async (task: Task, status: TaskStatus) => {
  if (task.status === status || isUpdating(task.id)) return
  errorMessage.value = ''
  updatingTaskIds.value = [...updatingTaskIds.value, task.id]
  try {
    const updated = await $fetch<Task>(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      body: { status },
    })
    emit('changed', updated)
    void refreshTaskViews()
  } catch (error: unknown) {
    captureException(error, { flow: 'board_status_update' })
    errorMessage.value = `Kobi could not move “${task.title}”. Try again.`
  } finally {
    updatingTaskIds.value = updatingTaskIds.value.filter(id => id !== task.id)
  }
}

const startDrag = (event: DragEvent, task: Task) => {
  if (isUpdating(task.id)) return
  draggedTaskId.value = task.id
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', task.id)
  }
}

const dropTask = (event: DragEvent, status: TaskStatus) => {
  const taskId = draggedTaskId.value ?? event.dataTransfer?.getData('text/plain')
  draggedTaskId.value = null
  const task = props.tasks.find(item => item.id === taskId)
  if (task) void moveTask(task, status)
}

const changeStatus = (event: Event, task: Task) => {
  const value = (event.target as HTMLSelectElement).value
  const status = columns.find(column => column.status === value)?.status
  if (status) void moveTask(task, status)
}
</script>

<template>
  <div>
    <p v-if="errorMessage" class="board-error" role="alert">{{ errorMessage }}</p>
    <div class="board" aria-label="Task status board">
      <section
        v-for="column in columns"
        :key="column.status"
        class="board-column"
        :aria-labelledby="`board-${column.status}`"
        @dragover.prevent
        @drop.prevent="dropTask($event, column.status)"
      >
        <header class="board-column-header">
          <h2 :id="`board-${column.status}`">{{ column.label }}</h2>
          <span :aria-label="`${tasksFor(column.status).length} tasks`">{{ tasksFor(column.status).length }}</span>
        </header>
        <div v-if="tasksFor(column.status).length" class="board-column-tasks">
          <article
            v-for="task in tasksFor(column.status)"
            :key="task.id"
            class="board-card"
            :class="{ 'is-updating': isUpdating(task.id) }"
            :draggable="!isUpdating(task.id)"
            @dragstart="startDrag($event, task)"
            @dragend="draggedTaskId = null"
          >
            <div class="board-card-copy">
              <h3>{{ task.title }}</h3>
              <p v-if="task.description">{{ task.description }}</p>
            </div>
            <div v-if="task.projectTitle || task.dueDate || task.scheduledFor || task.assigneeName" class="board-card-meta">
              <span v-if="task.projectTitle">{{ task.projectTitle }}</span>
              <span v-if="task.dueDate">Due {{ task.dueDate }}</span>
              <span v-if="task.scheduledFor">Scheduled {{ task.scheduledFor }}</span>
              <span v-if="task.assigneeName">{{ task.assigneeName }}</span>
            </div>
            <select
              class="board-status-select"
              :value="task.status"
              :disabled="isUpdating(task.id)"
              :aria-label="`Status for ${task.title}`"
              @change="changeStatus($event, task)"
              @dragstart.stop
            >
              <option v-for="option in columns" :key="option.status" :value="option.status">
                {{ option.label }}
              </option>
            </select>
          </article>
        </div>
        <p v-else class="board-column-empty">{{ column.emptyMessage }}</p>
      </section>
    </div>
  </div>
</template>
