<script setup lang="ts">
import type { Task, WorkspaceMember } from '#shared/types/domain'

const props = withDefaults(defineProps<{ tasks: Task[], showReschedule?: boolean, emptyTitle?: string, emptyMessage?: string, enableAssignees?: boolean }>(), {
  showReschedule: false,
  emptyTitle: 'Nothing here',
  emptyMessage: 'You are all caught up.',
  enableAssignees: false,
})
const emit = defineEmits<{ changed: [] }>()
const { pendingTaskIds } = useToasts()
// A task whose delete is still undoable is already gone from the person's point of view, so it
// is filtered here rather than in each page.
const visibleTasks = computed(() => props.tasks.filter(task => !pendingTaskIds.value.includes(task.id)))
const { data: members } = await useFetch<WorkspaceMember[]>('/api/workspace/members', {
  key: 'workspace-members-task-list',
  default: () => [],
  lazy: true,
})
</script>

<template>
  <div v-if="visibleTasks.length" class="task-list">
    <TaskRow v-for="task in visibleTasks" :key="task.id" :task="task" :show-reschedule="props.showReschedule" :members="props.enableAssignees ? members : []" @updated="emit('changed')" @deleted="emit('changed')" />
  </div>
  <EmptyState v-else :title="props.emptyTitle" :message="props.emptyMessage" />
</template>
