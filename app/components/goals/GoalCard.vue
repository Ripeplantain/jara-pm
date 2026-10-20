<script setup lang="ts">
import type { Goal } from '#shared/types/domain'

defineProps<{ goal: Goal }>()
const { formatDate } = useDateFormat()
</script>

<template>
  <NuxtLink :to="`/goals/${goal.id}`" class="card entity-card" :class="{ 'is-archived': goal.status === 'archived' }">
    <div>
      <div class="entity-header">
        <h2>{{ goal.title }}</h2>
        <span class="status-badge" :class="goal.status">{{ goal.status }}</span>
      </div>
      <p>{{ goal.description || 'A meaningful outcome you are working toward.' }}</p>
      <ProgressBar :value="goal.progress" />
    </div>
    <div class="entity-meta">
      <span>{{ goal.projectCount }} {{ goal.projectCount === 1 ? 'project' : 'projects' }}</span>
      <span>{{ goal.targetDate ? `Target ${formatDate(goal.targetDate)}` : 'No target date' }}</span>
    </div>
  </NuxtLink>
</template>
