<script setup lang="ts">
import type { Task } from '#shared/types/domain'

withDefaults(defineProps<{ tasks: Task[], showReschedule?: boolean, emptyTitle?: string, emptyMessage?: string }>(), {
  showReschedule: false,
  emptyTitle: 'Nothing here',
  emptyMessage: 'You are all caught up.',
})
const emit = defineEmits<{ changed: [] }>()
</script>

<template>
  <div v-if="tasks.length" class="task-list">
    <TaskRow v-for="task in tasks" :key="task.id" :task="task" :show-reschedule="showReschedule" @updated="emit('changed')" @deleted="emit('changed')" />
  </div>
  <EmptyState v-else :title="emptyTitle" :message="emptyMessage" />
</template>
