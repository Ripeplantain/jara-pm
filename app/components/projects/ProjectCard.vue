<script setup lang="ts">
import type { Project } from '#shared/types/domain'

defineProps<{ project: Project }>()
const { formatDate } = useDateFormat()
</script>

<template>
  <NuxtLink :to="`/projects/${project.id}`" class="card entity-card project-card" :class="{ 'is-archived': project.status === 'archived' }">
    <div>
      <div class="entity-header">
        <h2>{{ project.title }}</h2>
        <span class="status-badge" :class="project.status">{{ project.status }}</span>
      </div>
      <p>{{ project.description || 'A focused collection of work.' }}</p>
      <ProgressBar :value="project.progress" />
    </div>
    <div class="entity-meta">
      <span>{{ project.taskCount }} {{ project.taskCount === 1 ? 'task' : 'tasks' }}</span>
      <span>{{ project.targetDate ? `Due ${formatDate(project.targetDate)}` : 'No deadline' }}</span>
    </div>
  </NuxtLink>
</template>
