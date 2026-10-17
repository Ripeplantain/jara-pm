<script setup lang="ts">
import type { Task } from '#shared/types/domain'

definePageMeta({ middleware: ['authenticated'] })
useSeoMeta({ title: 'Upcoming · Kobi' })
const { data: tasks, status, error, refresh } = await useFetch<Task[]>('/api/tasks', {
  key: 'upcoming-tasks', query: { scope: 'upcoming' }, default: () => [],
})

const start = new Date()
start.setHours(0, 0, 0, 0)
const tomorrowValue = new Date(start.getTime() + 86_400_000).toISOString().slice(0, 10)
const weekValue = new Date(start.getTime() + 7 * 86_400_000).toISOString().slice(0, 10)
const tomorrow = computed(() => tasks.value.filter(task => task.dueDate === tomorrowValue))
const thisWeek = computed(() => tasks.value.filter(task => task.dueDate && task.dueDate > tomorrowValue && task.dueDate <= weekValue))
const later = computed(() => tasks.value.filter(task => task.dueDate && task.dueDate > weekValue))
</script>

<template>
  <main class="page narrow">
    <header class="page-header">
      <div><div class="eyebrow">What’s ahead</div><h1>Upcoming</h1><p>A chronological view of the work you have committed to.</p></div>
    </header>
    <LoadingState v-if="status === 'pending'" />
    <ErrorState v-else-if="error" @retry="refresh" />
    <template v-else>
      <section class="section"><div class="section-heading"><h2>Tomorrow</h2><span>{{ tomorrow.length }}</span></div><TaskList :tasks="tomorrow" show-reschedule @changed="refresh" /></section>
      <section class="section"><div class="section-heading"><h2>This week</h2><span>{{ thisWeek.length }}</span></div><TaskList :tasks="thisWeek" show-reschedule @changed="refresh" /></section>
      <section class="section"><div class="section-heading"><h2>Later</h2><span>{{ later.length }}</span></div><TaskList :tasks="later" show-reschedule @changed="refresh" /></section>
    </template>
  </main>
</template>
