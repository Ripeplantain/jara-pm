<script setup lang="ts">
import { Moon, Sparkles, Sun } from '@lucide/vue'

const { open } = useAskKobi()
const { theme, toggle } = useTheme()
const { activeWorkspace } = useWorkspaces()

// Filled after mount: the server's idea of "today" can differ from the person's, and rendering
// it on the server would risk a hydration mismatch.
const today = ref('')
onMounted(() => {
  today.value = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())
})
</script>

<template>
  <header class="app-topbar">
    <div class="topbar-context">
      <AppLogo />
      <WorkspaceSwitcher compact />
    </div>
    <p class="topbar-where">
      <span v-if="activeWorkspace">{{ activeWorkspace.name }}</span>
      <template v-if="activeWorkspace && today"> <span aria-hidden="true">·</span> </template>
      <span v-if="today">{{ today }}</span>
    </p>
    <div class="stack-actions">
      <button type="button" class="icon-button touch" aria-label="Dark theme" :aria-pressed="theme === 'dark'" @click="toggle">
        <Moon v-if="theme === 'dark'" :size="18" aria-hidden="true" />
        <Sun v-else :size="18" aria-hidden="true" />
      </button>
      <button type="button" class="icon-button touch" aria-label="Ask Kobi" @click="open()">
        <Sparkles :size="18" aria-hidden="true" />
      </button>
    </div>
  </header>
</template>
