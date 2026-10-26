<script setup lang="ts">
import type { Goal } from '#shared/types/domain'

// A large ring tile. It is a button, not a link: selecting it opens the goal drawer, and the
// full page stays reachable from there (and by URL).
defineProps<{ goal: Goal, selected?: boolean }>()
defineEmits<{ select: [] }>()
const { formatDate } = useDateFormat()
const { isCompact } = useCompactViewport()
</script>

<template>
  <button
    type="button"
    class="goal-tile"
    :class="{ 'is-archived': goal.status === 'archived' }"
    :aria-pressed="selected ? 'true' : 'false'"
    :aria-label="`${goal.title}. ${goal.progress === null ? 'Not measured' : `${goal.progress}% done`}. Open details`"
    @click="$emit('select')"
  >
    <ProgressRing :value="goal.progress" :size="isCompact ? 88 : 148" :label="`${goal.title} progress`" />
    <span class="goal-tile-text">
      <span class="goal-tile-title">{{ goal.title }}</span>
      <span class="goal-tile-meta">
        <span class="status-badge" :class="goal.status">{{ goal.status }}</span>
        <span>{{ goal.targetDate ? `By ${formatDate(goal.targetDate)}` : 'No target date' }}</span>
      </span>
      <span class="goal-tile-progress">{{ goal.progress === null ? 'Not measured' : `${goal.completedTaskCount} of ${goal.taskCount} tasks` }}</span>
    </span>
  </button>
</template>
