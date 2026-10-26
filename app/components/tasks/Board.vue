<script setup lang="ts">
import type { Status, Task } from '#shared/types/domain'

const props = defineProps<{ tasks: Task[] }>()
const emit = defineEmits<{ changed: [task: Task] }>()
const { patch, decorateAll } = useOptimisticTask()
const { openTask } = useTaskPanel()
// One column per workspace status, in the workspace's own order -- the board no longer assumes
// a fixed three-step workflow.
const { statuses: columns } = useStatuses()

// The board reads through the shared overlay, so a card that was moved on another surface -- or
// by the command palette -- is already in its new column here.
const boardTasks = computed(() => decorateAll(props.tasks))

const draggedTaskId = ref<string | null>(null)

const tasksFor = (status: Status) => boardTasks.value.filter(task => task.status.id === status.id)

const emptyMessageFor = (status: Status) => `No tasks in ${status.name}.`

// The card moves column on the drop, before the request is sent. A failure puts it back and
// raises one toast, so there is no per-card spinner and nothing is disabled mid-drag.
const moveTask = async (task: Task, status: Status) => {
  if (task.status.id === status.id) return
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

const dropTask = (event: DragEvent, status: Status) => {
  const taskId = draggedTaskId.value ?? event.dataTransfer?.getData('text/plain')
  draggedTaskId.value = null
  const task = boardTasks.value.find(item => item.id === taskId)
  if (task) void moveTask(task, status)
}

const changeStatus = (event: Event, task: Task) => {
  const value = (event.target as HTMLSelectElement).value
  const status = columns.value.find(column => column.id === value)
  if (status) void moveTask(task, status)
}
</script>

<template>
  <div>
    <div class="board" aria-label="Task status board">
      <section
        v-for="column in columns"
        :key="column.id"
        class="board-column"
        :aria-labelledby="`board-${column.id}`"
        @dragover.prevent
        @drop.prevent="dropTask($event, column)"
      >
        <header class="board-column-header">
          <h2 :id="`board-${column.id}`">{{ column.name }}</h2>
          <span :aria-label="`${tasksFor(column).length} tasks`">{{ tasksFor(column).length }}</span>
        </header>
        <div v-if="tasksFor(column).length" class="board-column-tasks">
          <article
            v-for="task in tasksFor(column)"
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
            <div v-if="task.priority !== 'none' || task.projectTitle || task.dueDate || task.scheduledFor || task.assigneeName" class="board-card-meta">
              <PriorityMark v-if="task.priority !== 'none'" :priority="task.priority" />
              <span v-if="task.projectTitle">{{ task.projectTitle }}</span>
              <span v-if="task.dueDate">Due {{ task.dueDate }}</span>
              <span v-if="task.scheduledFor">Scheduled {{ task.scheduledFor }}</span>
              <span v-if="task.assigneeName">{{ task.assigneeName }}</span>
            </div>
            <select
              class="board-status-select"
              :value="task.status.id"
              :aria-label="`Status for ${task.title}`"
              @change="changeStatus($event, task)"
              @dragstart.stop
            >
              <option v-for="option in columns" :key="option.id" :value="option.id">
                {{ option.name }}
              </option>
            </select>
          </article>
        </div>
        <p v-else class="board-column-empty">{{ emptyMessageFor(column) }}</p>
      </section>
    </div>
  </div>
</template>
