<script setup lang="ts">
import { ExternalLink, Maximize2, Minimize2, X } from '@lucide/vue'

// Quick-use side panel. The conversation itself lives in AskKobiConversation, shared with /ask.
const emit = defineEmits<{ close: [] }>()
const isMaximized = ref(false)

onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div class="ask-overlay" @click="emit('close')" />
    <aside class="ask-panel" :class="{ 'is-maximized': isMaximized }" role="dialog" aria-modal="true" aria-labelledby="ask-title">
      <header class="ask-header">
        <h2 id="ask-title">Ask Kobi</h2>
        <div class="ask-header-actions">
          <NuxtLink to="/ask" class="button ghost small" @click="emit('close')">
            <ExternalLink :size="14" aria-hidden="true" /> Open full view
          </NuxtLink>
          <button
            type="button"
            class="icon-button"
            :aria-label="isMaximized ? 'Minimize Ask Kobi' : 'Maximize Ask Kobi'"
            :aria-pressed="isMaximized"
            :title="isMaximized ? 'Minimize' : 'Maximize'"
            @click="isMaximized = !isMaximized"
          >
            <Minimize2 v-if="isMaximized" :size="18" />
            <Maximize2 v-else :size="18" />
          </button>
          <button type="button" class="icon-button" aria-label="Close Ask Kobi" @click="emit('close')"><X :size="18" /></button>
        </div>
      </header>
      <AskKobiConversation layout="panel" @navigate="emit('close')" />
    </aside>
  </Teleport>
</template>
