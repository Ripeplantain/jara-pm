<script setup lang="ts">
import { Check, PanelRight, Pause, Play, RotateCcw, Timer, Undo2 } from '@lucide/vue'
import type { Task } from '#shared/types/domain'
import { FOCUS_SESSION_SECONDS, formatTimer, secondsRemaining } from '#shared/utils/focus-timer'

const props = defineProps<{ task: Task }>()
const emit = defineEmits<{ updated: [task: Task] }>()
const { capture } = useProductAnalytics()
const { patch, decorate } = useOptimisticTask()
const { openTask } = useTaskPanel()
const { focus: focusTask } = useFocusedTask()
const { defaultStatus, completedStatus } = useStatuses()

const current = computed(() => decorate(props.task))
const isDone = computed(() => current.value.status.category === 'completed')

// Same completion path as TaskRow: the lowest-position completed status, or the workspace default
// when reopening.
const toggle = async () => {
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

// Focus timer: browser-only, in memory. Nothing is saved or sent, and it resets with the task.
const remaining = ref(FOCUS_SESSION_SECONDS)
const isRunning = ref(false)
const isFinished = ref(false)
let endsAt = 0
let intervalId: ReturnType<typeof setInterval> | null = null

const stopTicking = () => {
  if (intervalId !== null) clearInterval(intervalId)
  intervalId = null
  isRunning.value = false
}

const tick = () => {
  remaining.value = secondsRemaining(endsAt, Date.now())
  if (remaining.value > 0) return
  stopTicking()
  isFinished.value = true
}

const startTimer = () => {
  if (!import.meta.client || isRunning.value) return
  if (remaining.value <= 0) remaining.value = FOCUS_SESSION_SECONDS
  isFinished.value = false
  endsAt = Date.now() + remaining.value * 1000
  isRunning.value = true
  intervalId = setInterval(tick, 250)
}

const pauseTimer = () => {
  if (isRunning.value) remaining.value = secondsRemaining(endsAt, Date.now())
  stopTicking()
}

const resetTimer = () => {
  stopTicking()
  remaining.value = FOCUS_SESSION_SECONDS
  isFinished.value = false
}

const isUntouched = computed(() => !isRunning.value && !isFinished.value && remaining.value === FOCUS_SESSION_SECONDS)

watch(() => props.task.id, resetTimer)
onBeforeUnmount(stopTicking)
</script>

<template>
  <article class="now-card" :class="{ 'is-done': isDone }" aria-labelledby="now-card-title" @focusin="focusTask(current)" @mouseenter="focusTask(current)">
    <p class="now-eyebrow"><span class="now-dot" aria-hidden="true" /> Now</p>
    <h3 id="now-card-title" class="now-title">{{ current.title }}</h3>
    <p class="now-trail">
      <span class="task-key">{{ current.key }}</span>
      <span v-if="current.projectTitle">{{ current.projectTitle }}</span>
      <span v-if="current.milestoneTitle">· {{ current.milestoneTitle }}</span>
    </p>
    <ul class="now-meta">
      <li v-if="current.dueDate">Due {{ current.dueDate }}</li>
      <li v-if="current.priority !== 'none'"><PriorityMark :priority="current.priority" /></li>
      <li>{{ current.status.name }}</li>
    </ul>
    <div class="now-actions">
      <button type="button" class="button" :aria-label="isDone ? `Reopen ${current.title}` : `Complete ${current.title}`" @click="toggle">
        <Undo2 v-if="isDone" :size="16" aria-hidden="true" />
        <Check v-else :size="16" aria-hidden="true" />
        {{ isDone ? 'Reopen' : 'Complete' }}
      </button>
      <button type="button" class="button secondary" :aria-label="`Open ${current.key}`" @click="openTask(current.key)">
        <PanelRight :size="16" aria-hidden="true" /> Open
      </button>
    </div>
    <div class="now-timer" role="group" aria-label="Focus timer">
      <Timer :size="16" aria-hidden="true" class="now-timer-icon" />
      <span class="now-timer-time" role="timer" :aria-label="`Time remaining ${formatTimer(remaining)}`">{{ formatTimer(remaining) }}</span>
      <button v-if="isRunning" type="button" class="button secondary" aria-label="Pause focus timer" @click="pauseTimer">
        <Pause :size="16" aria-hidden="true" /> Pause
      </button>
      <button v-else type="button" class="button secondary" :aria-label="isUntouched || isFinished ? 'Start focus timer' : 'Resume focus timer'" @click="startTimer">
        <Play :size="16" aria-hidden="true" /> {{ isUntouched || isFinished ? 'Start' : 'Resume' }}
      </button>
      <button type="button" class="button ghost" aria-label="Reset focus timer" :disabled="isUntouched" @click="resetTimer">
        <RotateCcw :size="16" aria-hidden="true" /> Reset
      </button>
      <p class="now-timer-note" aria-live="polite">{{ isFinished ? 'Session done' : '' }}</p>
    </div>
  </article>
</template>
