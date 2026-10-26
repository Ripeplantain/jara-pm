<script setup lang="ts">
// A 2px progress line. `null` means "not measured" and is drawn as a dashed empty line, never 0%.
defineProps<{ value: number | null, label?: string }>()
</script>

<template>
  <div class="progress-row">
    <div class="progress-label">
      <span>{{ label || 'Progress' }}</span>
      <span>{{ value === null ? 'Not measured' : `${value}%` }}</span>
    </div>
    <div
      class="progress"
      :class="{ 'is-unmeasured': value === null }"
      role="progressbar"
      :aria-label="label || 'Progress'"
      :aria-valuenow="value ?? undefined"
      :aria-valuetext="value === null ? 'Not measured' : `${value}%`"
      aria-valuemin="0"
      aria-valuemax="100"
    >
      <span v-if="value !== null" :style="{ width: `${value}%` }" />
    </div>
  </div>
</template>
