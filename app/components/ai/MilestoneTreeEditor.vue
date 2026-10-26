<script setup lang="ts">
import { Trash2 } from '@lucide/vue'
import { MAX_TITLE_LENGTH } from '#shared/schemas/common'
import { TASK_PRIORITIES } from '#shared/types/domain'
import type { DraftMilestone } from '~/composables/useProposalDraft'

// The milestone/task half of the plan editor, shared by the goal plan and the project
// breakdown. Like ProposalEditor it only mutates the draft it is given and emits nothing.
const milestones = defineModel<DraftMilestone[]>({ required: true })

const dateValue = (event: Event) => (event.target as HTMLInputElement).value || null

const removeMilestone = (index: number) => milestones.value.splice(index, 1)
const removeTask = (milestone: DraftMilestone, index: number) => milestone.tasks.splice(index, 1)
const lastReason = (level: string) => `A plan needs at least one ${level}`
</script>

<template>
  <div class="proposal-milestones">
    <div v-for="(milestone, milestoneIndex) in milestones" :key="milestone.id" class="proposal-milestone">
      <div class="proposal-edit-row">
        <input v-model="milestone.title" class="input" :maxlength="MAX_TITLE_LENGTH" aria-label="Milestone title">
        <input type="date" class="input proposal-edit-date-input" :value="milestone.targetDate ?? ''" aria-label="Milestone target date" @input="milestone.targetDate = dateValue($event)">
        <button
          type="button"
          class="icon-button"
          :disabled="milestones.length === 1"
          :title="milestones.length === 1 ? lastReason('milestone per project') : 'Remove milestone'"
          :aria-label="milestones.length === 1 ? lastReason('milestone per project') : 'Remove milestone'"
          @click="removeMilestone(milestoneIndex)"
        >
          <Trash2 :size="15" />
        </button>
      </div>
      <ul class="proposal-tasks">
        <li v-for="(task, taskIndex) in milestone.tasks" :key="task.id" class="proposal-task proposal-edit-task">
          <input v-model="task.title" class="input" :maxlength="MAX_TITLE_LENGTH" aria-label="Task title">
          <input type="date" class="input proposal-edit-date-input" :value="task.dueDate ?? ''" aria-label="Task due date" @input="task.dueDate = dateValue($event)">
          <select v-model="task.priority" class="select proposal-edit-priority" aria-label="Task priority">
            <option v-for="priority in TASK_PRIORITIES" :key="priority" :value="priority">{{ priority }}</option>
          </select>
          <button
            type="button"
            class="icon-button"
            :disabled="milestone.tasks.length === 1"
            :title="milestone.tasks.length === 1 ? lastReason('task per milestone') : 'Remove task'"
            :aria-label="milestone.tasks.length === 1 ? lastReason('task per milestone') : 'Remove task'"
            @click="removeTask(milestone, taskIndex)"
          >
            <Trash2 :size="15" />
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>
