<script setup lang="ts">
import type { Task } from '#shared/types/domain'

definePageMeta({ middleware: ['authenticated'] })
useSeoMeta({ title: 'Board · Kobi' })

const { data: tasks, status, error, refresh } = await useFetch<Task[]>('/api/tasks', {
  key: 'board-tasks',
  query: { scope: 'all', includeCompleted: 'true' },
  default: () => [],
})

// `replaceTask` used to live here, splicing the returned row into this one page's array. That
// job now belongs to `useOptimisticTask`, which records the change once for every surface.
</script>

<template>
  <main class="page board-page">
    <header class="page-header">
      <div>
        <div class="eyebrow">Every task, one workflow</div>
        <h1>Board</h1>
        <p>Move work through your workflow, or use each task’s status menu.</p>
      </div>
      <div class="page-actions"><NuxtLink to="/projects" class="button secondary small">Projects</NuxtLink></div>
    </header>
    <LoadingState v-if="status === 'pending'" />
    <ErrorState v-else-if="error" @retry="refresh" />
    <Board v-else :tasks="tasks" />
  </main>
</template>
