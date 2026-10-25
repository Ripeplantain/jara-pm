<script setup lang="ts">
import type { Task, WorkspaceMember } from '#shared/types/domain'
import { parseTaskKey } from '#shared/utils/task-key'

definePageMeta({
  middleware: ['authenticated'],
  // Without this, `/[taskKey]` would swallow every unmatched path and turn an ordinary 404
  // into a task lookup. Only something shaped like `ACME-7` reaches the page at all.
  validate: route => parseTaskKey(String(route.params.taskKey)) !== null,
})

const route = useRoute()
const taskKey = computed(() => String(route.params.taskKey))

const { data: task, error, refresh } = await useFetch<Task>(() => `/api/tasks/by-key/${taskKey.value}`, {
  key: `task-by-key-${taskKey.value}`,
})

const emptyMembers = (): WorkspaceMember[] => []
const { data: members } = await useFetch<WorkspaceMember[]>('/api/workspace/members', {
  key: 'workspace-members',
  default: emptyMembers,
})

useSeoMeta({ title: computed(() => task.value ? `${task.value.key} ${task.value.title} · Kobi` : 'Task · Kobi') })

const onUpdated = (updated: Task) => {
  task.value = updated
}
</script>

<template>
  <main class="page narrow">
    <ErrorState
      v-if="error"
      :message="`Nothing in this workspace is numbered ${taskKey}.`"
      @retry="refresh"
    />
    <template v-else-if="task">
      <header class="page-header">
        <div>
          <div class="eyebrow">{{ task.projectTitle || 'Inbox' }}</div>
          <h1><span class="task-key">{{ task.key }}</span> {{ task.title }}</h1>
          <p v-if="task.description"><TaskText :text="task.description" /></p>
        </div>
      </header>
      <section class="card card-pad">
        <div class="task-list">
          <TaskRow
            :task="task"
            :members="members"
            show-reschedule
            @updated="onUpdated"
            @deleted="navigateTo('/inbox')"
          />
        </div>
      </section>
    </template>
    <LoadingState v-else />
  </main>
</template>
