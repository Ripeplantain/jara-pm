<script setup lang="ts">
import { Moon, Sparkles, Sun } from '@lucide/vue'

const { open } = useAskKobi()
const { theme, toggle } = useTheme()
</script>

<template>
  <header class="app-topbar">
    <div class="topbar-context">
      <AppLogo />
      <WorkspaceSwitcher compact />
    </div>
    <div class="stack-actions">
      <button type="button" class="icon-button" :aria-label="`Use ${theme === 'dark' ? 'light' : 'dark'} theme`" @click="toggle">
        <Sun v-if="theme === 'dark'" :size="17" aria-hidden="true" />
        <Moon v-else :size="17" aria-hidden="true" />
      </button>
      <button type="button" class="icon-button" aria-label="Ask Kobi" @click="open()">
        <Sparkles :size="17" aria-hidden="true" />
      </button>
    </div>
  </header>
</template>
