<script setup lang="ts">
import type { Task } from '#shared/types/domain'

const props = withDefaults(defineProps<{ tasks: Task[], showReschedule?: boolean, enableTriage?: boolean, emptyTitle?: string, emptyMessage?: string, enableAssignees?: boolean }>(), {
  showReschedule: false,
  enableTriage: false,
  emptyTitle: 'Nothing here',
  emptyMessage: 'You are all caught up.',
  enableAssignees: false,
})
const emit = defineEmits<{ changed: [] }>()
const { pendingTaskIds } = useToasts()
// A task whose delete is still undoable is already gone from the person's point of view, so it
// is filtered here rather than in each page. Pending edits are not merged here: every `TaskRow`
// decorates its own task, so doing it again would be the same work twice per row.
const visibleTasks = computed(() => props.tasks.filter(task => !pendingTaskIds.value.includes(task.id)))
const { data: members } = await useWorkspaceMembers()
</script>

<template>
  <div v-if="visibleTasks.length" class="task-list">
    <TaskRow v-for="task in visibleTasks" :key="task.id" :task="task" :show-reschedule="props.showReschedule" :enable-triage="props.enableTriage" :members="props.enableAssignees ? members : []" @updated="emit('changed')" @deleted="emit('changed')" />
  </div>
  <EmptyState v-else :title="props.emptyTitle" :message="props.emptyMessage" />
</template>
