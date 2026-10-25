<script setup lang="ts">
import type { Task, TaskStatus } from '#shared/types/domain'

const props = defineProps<{ tasks: Task[] }>()
const emit = defineEmits<{ changed: [task: Task] }>()
const { patch, decorateAll } = useOptimisticTask()
const { openTask } = useTaskPanel()

// The board reads through the shared overlay, so a card that was moved on another surface -- or
// by the command palette -- is already in its new column here.
const boardTasks = computed(() => decorateAll(props.tasks))

const columns: ReadonlyArray<{ status: TaskStatus, label: string, emptyMessage: string }> = [
  { status: 'todo', label: 'To do', emptyMessage: 'No tasks waiting to start.' },
  { status: 'in_progress', label: 'In progress', emptyMessage: 'No tasks are in progress.' },
  { status: 'done', label: 'Done', emptyMessage: 'No completed tasks yet.' },
]
const draggedTaskId = ref<string | null>(null)

const tasksFor = (status: TaskStatus) => boardTasks.value.filter(task => task.status === status)

// The card moves column on the drop, before the request is sent. A failure puts it back and
// raises one toast, so there is no per-card spinner and nothing is disabled mid-drag.
const moveTask = async (task: Task, status: TaskStatus) => {
  if (task.status === status) return
  const updated = await patch(task, { status }, {
    flow: 'board_status_update',
    message: `Kobi could not move “${task.title}”.`,
  })
  if (updated) emit('changed', updated)
}

const startDrag = (event: DragEvent, task: Task) => {
  draggedTaskId.value = task.id
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', task.id)
  }
}

const dropTask = (event: DragEvent, status: TaskStatus) => {
  const taskId = draggedTaskId.value ?? event.dataTransfer?.getData('text/plain')
  draggedTaskId.value = null
  const task = boardTasks.value.find(item => item.id === taskId)
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
            draggable="true"
            @dragstart="startDrag($event, task)"
            @dragend="draggedTaskId = null"
          >
            <div class="board-card-copy">
              <h3>
                <button type="button" class="task-title-button" :aria-label="`Open ${task.key}`" @click="openTask(task.key)">
                  <span class="task-key">{{ task.key }}</span> {{ task.title }}
                </button>
              </h3>
              <p v-if="task.description"><TaskText :text="task.description" /></p>
              <div v-if="task.labels.length" class="task-labels">
                <LabelChip v-for="label in task.labels" :key="label.id" :label="label" />
              </div>
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
