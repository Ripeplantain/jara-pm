<script setup lang="ts">
import { Trash2 } from '@lucide/vue'
import { MAX_PLAN_DESCRIPTION_LENGTH } from '#shared/schemas/ai'
import { MAX_TITLE_LENGTH } from '#shared/schemas/common'
import { TASK_PRIORITIES } from '#shared/types/domain'
import type { DraftPlan } from '~/composables/useProposalDraft'

// The panel derives "edited" by comparing values, so this component emits nothing: it
// only mutates the draft it is given.
const plan = defineModel<DraftPlan>({ required: true })

const dateValue = (event: Event) => (event.target as HTMLInputElement).value || null

const removeProject = (index: number) => plan.value.projects.splice(index, 1)
const removeMilestone = (project: DraftPlan['projects'][number], index: number) => project.milestones.splice(index, 1)
const removeTask = (milestone: DraftPlan['projects'][number]['milestones'][number], index: number) => milestone.tasks.splice(index, 1)
const lastReason = (level: string) => `A plan needs at least one ${level}`
</script>

<template>
  <div class="proposal-editor">
    <input v-model="plan.goal.title" class="input proposal-edit-title" :maxlength="MAX_TITLE_LENGTH" aria-label="Goal title">
    <textarea v-model="plan.goal.description" class="textarea proposal-edit-description" :maxlength="MAX_PLAN_DESCRIPTION_LENGTH" aria-label="Goal description" />
    <label class="proposal-edit-date">
      <span>Goal target date</span>
      <input type="date" class="input" :value="plan.goal.targetDate ?? ''" @input="plan.goal.targetDate = dateValue($event)">
    </label>
    <ul class="proposal-projects">
      <li v-for="(project, projectIndex) in plan.projects" :key="project.id" class="proposal-project">
        <div class="proposal-edit-row">
          <input v-model="project.title" class="input" :maxlength="MAX_TITLE_LENGTH" aria-label="Project title">
          <button
            type="button"
            class="icon-button"
            :disabled="plan.projects.length === 1"
            :title="plan.projects.length === 1 ? lastReason('project') : 'Remove project'"
            :aria-label="plan.projects.length === 1 ? lastReason('project') : 'Remove project'"
            @click="removeProject(projectIndex)"
          >
            <Trash2 :size="15" />
          </button>
        </div>
        <textarea v-model="project.description" class="textarea proposal-edit-description" :maxlength="MAX_PLAN_DESCRIPTION_LENGTH" aria-label="Project description" />
        <div class="proposal-milestones">
          <div v-for="(milestone, milestoneIndex) in project.milestones" :key="milestone.id" class="proposal-milestone">
            <div class="proposal-edit-row">
              <input v-model="milestone.title" class="input" :maxlength="MAX_TITLE_LENGTH" aria-label="Milestone title">
              <input type="date" class="input proposal-edit-date-input" :value="milestone.targetDate ?? ''" aria-label="Milestone target date" @input="milestone.targetDate = dateValue($event)">
              <button
                type="button"
                class="icon-button"
                :disabled="project.milestones.length === 1"
                :title="project.milestones.length === 1 ? lastReason('milestone per project') : 'Remove milestone'"
                :aria-label="project.milestones.length === 1 ? lastReason('milestone per project') : 'Remove milestone'"
                @click="removeMilestone(project, milestoneIndex)"
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
      </li>
    </ul>
  </div>
</template>
