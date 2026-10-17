<script setup lang="ts">
import type { Task } from '#shared/types/domain'

definePageMeta({ middleware: ['authenticated'] })
useSeoMeta({ title: 'Inbox · Kobi' })
const { open } = useAskKobi()
const { data: tasks, status, error, refresh } = await useFetch<Task[]>('/api/tasks', {
  key: 'inbox-tasks', query: { scope: 'inbox' }, default: () => [],
})
</script>

<template>
  <main class="page narrow">
    <header class="page-header">
      <div><div class="eyebrow">Capture first</div><h1>Inbox</h1><p>Collect tasks quickly. Organize them when you are ready.</p></div>
    </header>
    <QuickCapture placeholder="Add something to your inbox…" @created="refresh" @ask="open" />
    <LoadingState v-if="status === 'pending'" />
    <ErrorState v-else-if="error" @retry="refresh" />
    <TaskList v-else :tasks="tasks" empty-title="Inbox zero" empty-message="New unorganized tasks will appear here." @changed="refresh" />
  </main>
</template>
