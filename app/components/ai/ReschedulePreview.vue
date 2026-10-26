<script setup lang="ts">
import { X } from '@lucide/vue'
import type { Task } from '#shared/types/domain'

const props = defineProps<{ tasks: Task[] }>()
const draft = defineModel<RescheduleDraft>({ required: true })
const taskFor = (taskId: string) => props.tasks.find(task => task.id === taskId)
const remove = (id: string) => { draft.value.changes = draft.value.changes.filter(change => change.id !== id) }
const dateValue = (event: Event) => (event.target as HTMLInputElement).value || null
</script>

<template>
  <div class="reschedule-preview">
    <p v-if="draft.note" class="form-hint">{{ draft.note }}</p>
    <div v-for="change in draft.changes" :key="change.id" class="reschedule-change">
      <div class="reschedule-change-heading">
        <strong><span class="task-key">{{ taskFor(change.taskId)?.key }}</span> {{ taskFor(change.taskId)?.title ?? 'Task' }}</strong>
        <button type="button" class="icon-button" aria-label="Discard this change" @click="remove(change.id)"><X :size="15" /></button>
      </div>
      <div class="reschedule-diff">
        <span class="old-value">{{ taskFor(change.taskId)?.dueDate ?? 'No due date' }}</span><span aria-hidden="true">→</span>
        <label class="field"><span>New due date</span><input :value="change.dueDate ?? ''" type="date" class="input" @input="change.dueDate = dateValue($event)"></label>
        <label class="field"><span>Schedule</span><input :value="change.scheduledFor ?? ''" type="date" class="input" @input="change.scheduledFor = dateValue($event)"></label>
        <label class="field"><span>Status</span><select v-model="change.statusCategory" class="select"><option :value="null">Keep current</option><option value="backlog">Park in backlog</option><option value="canceled">Cancel</option></select></label>
        <label class="check-field"><input v-model="change.selectedForToday" type="checkbox"> Add to Today</label>
      </div>
      <p v-if="change.reason" class="form-hint">{{ change.reason }}</p>
    </div>
  </div>
</template>
