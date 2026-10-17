<script setup lang="ts">
import { Inbox } from '@lucide/vue'

defineProps<{ title: string, message: string }>()
</script>

<template>
  <div class="empty-state">
    <div>
      <span class="empty-icon"><Inbox :size="20" aria-hidden="true" /></span>
      <strong>{{ title }}</strong>
      <span class="empty-state-message">{{ message }}</span>
      <div v-if="$slots.default" class="empty-state-action"><slot /></div>
    </div>
  </div>
</template>
