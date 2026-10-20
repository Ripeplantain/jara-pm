<script setup lang="ts">
import { X } from '@lucide/vue'

const { toasts, commit, undo, flushPending, prunePendingTasks } = useToasts()
const route = useRoute()

// Leaving the page must not leave a delete queued against it, so a route change commits whatever
// is still pending and then clears the hidden-row registry.
watch(() => route.fullPath, () => void prunePendingTasks())

onMounted(() => {
  const handler = () => void flushPending()
  window.addEventListener('beforeunload', handler)
  onBeforeUnmount(() => window.removeEventListener('beforeunload', handler))
})
</script>

<template>
  <Teleport to="body">
    <!-- Polite, so a completed action is announced without interrupting what is being read. -->
    <div class="toast-host" role="status" aria-live="polite">
      <div v-for="toast in toasts" :key="toast.id" class="toast">
        <p class="toast-message">{{ toast.message }}</p>
        <button
          v-if="toast.actionLabel"
          type="button"
          class="toast-action"
          @click="undo(toast.id)"
        >
          {{ toast.actionLabel }}
        </button>
        <button
          type="button"
          class="toast-dismiss"
          :aria-label="`Dismiss: ${toast.message}`"
          @click="commit(toast.id)"
        >
          <X :size="15" aria-hidden="true" />
        </button>
      </div>
    </div>
  </Teleport>
</template>
