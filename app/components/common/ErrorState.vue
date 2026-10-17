<script setup lang="ts">
defineProps<{ message?: string }>()
defineEmits<{ retry: [] }>()
</script>

<template>
  <div class="error-state">
    <div>
      <strong>Something went wrong</strong>
      <p>{{ message || 'Kobi could not load this right now.' }}</p>
      <button type="button" class="button secondary small" @click="$emit('retry')">Try again</button>
    </div>
  </div>
</template>
