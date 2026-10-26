<script setup lang="ts">
import { Trash2 } from '@lucide/vue'
import { MAX_PLAN_DESCRIPTION_LENGTH } from '#shared/schemas/ai'
import { MAX_TITLE_LENGTH } from '#shared/schemas/common'
import type { DraftPlan } from '~/composables/useProposalDraft'

// The panel derives "edited" by comparing values, so this component emits nothing: it
// only mutates the draft it is given.
const plan = defineModel<DraftPlan>({ required: true })

const dateValue = (event: Event) => (event.target as HTMLInputElement).value || null

const removeProject = (index: number) => plan.value.projects.splice(index, 1)
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
        <MilestoneTreeEditor v-model="project.milestones" />
      </li>
    </ul>
  </div>
</template>
