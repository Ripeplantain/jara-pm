<script setup lang="ts">
import type { TaskPriority } from '#shared/types/domain'

const props = defineProps<{ priority: TaskPriority }>()
const level = computed(() => ({ none: 0, low: 1, medium: 2, high: 3 })[props.priority])
const text = computed(() => (props.priority === 'none' ? 'No priority' : `${props.priority[0]?.toUpperCase()}${props.priority.slice(1)}`))
</script>

<template>
  <span class="priority-mark" :class="{ 'is-high': priority === 'high' }">
    <span class="priority-bars" aria-hidden="true">
      <i v-for="n in 3" :key="n" :class="{ 'is-on': n <= level }" />
    </span>
    {{ text }}
  </span>
</template>
