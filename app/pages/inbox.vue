<script setup lang="ts">
import type { Task } from '#shared/types/domain'

definePageMeta({ middleware: ['authenticated'] })
useSeoMeta({ title: 'Inbox · Kobi' })
const { open } = useAskKobi()
const { isEnabled, toggle } = useListPreferences()
const showCompleted = computed(() => isEnabled('inbox.showCompleted'))
// The query is a computed, so flipping the toggle refetches under the same cache key. The
// parameter is omitted rather than sent as false, keeping the default request unchanged.
const { data: tasks, status, error, refresh } = await useFetch<Task[]>('/api/tasks', {
  key: 'inbox-tasks',
  query: computed(() => (showCompleted.value ? { scope: 'inbox', includeCompleted: 'true' } : { scope: 'inbox' })),
  default: () => [],
})
const completedCount = computed(() => tasks.value.filter(task => task.status.category === 'completed').length)
const menuItems = computed(() => [{
  label: 'Show Completed',
  checked: showCompleted.value,
  onSelect: () => toggle('inbox.showCompleted'),
}])
</script>

<template>
  <main class="page narrow">
    <header class="page-header">
      <div><div class="eyebrow">Capture first</div><h1>Inbox</h1><p>Collect tasks quickly. Organize them when you are ready.</p></div>
      <div class="page-actions">
        <span v-if="showCompleted && completedCount" class="status-badge completed">{{ completedCount }} completed</span>
        <MenuButton :items="menuItems" label="Inbox view options" />
      </div>
    </header>
    <QuickCapture placeholder="Add something to your inbox…" @created="refresh" @ask="open" />
    <LoadingState v-if="status === 'pending'" />
    <ErrorState v-else-if="error" @retry="refresh" />
    <TaskList v-else :tasks="tasks" empty-title="Inbox zero" empty-message="New unorganized tasks will appear here." />
  </main>
</template>
