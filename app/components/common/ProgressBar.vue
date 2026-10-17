<script setup lang="ts">
defineProps<{ value: number | null, label?: string }>()
</script>

<template>
  <div class="progress-row">
    <div class="progress-label">
      <span>{{ label || 'Progress' }}</span>
      <span>{{ value === null ? 'Not measured' : `${value}%` }}</span>
    </div>
    <div class="progress" role="progressbar" :aria-valuenow="value ?? undefined" aria-valuemin="0" aria-valuemax="100">
      <span :style="{ width: `${value ?? 0}%` }" />
    </div>
  </div>
</template>
