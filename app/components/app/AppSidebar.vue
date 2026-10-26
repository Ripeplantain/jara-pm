<script setup lang="ts">
import { CalendarDays, CirclePlus, Inbox, LayoutGrid, Settings, Sparkles, Target } from '@lucide/vue'

const { user } = useUserSession()
const { open } = useAskKobi()

const navigation = [
  { label: 'Today', to: '/', icon: CalendarDays },
  { label: 'Inbox', to: '/inbox', icon: Inbox },
  { label: 'Goals', to: '/goals', icon: Target },
  { label: 'Projects', to: '/projects', icon: CirclePlus },
  { label: 'Board', to: '/board', icon: LayoutGrid },
  { label: 'Upcoming', to: '/upcoming', icon: CalendarDays },
]

const initials = computed(() => user.value?.name.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase() ?? 'K')
</script>

<template>
  <aside class="app-sidebar" aria-label="Primary navigation">
    <AppLogo />
    <WorkspaceSwitcher />
    <nav class="sidebar-nav" aria-label="Sections">
      <NuxtLink v-for="item in navigation" :key="item.to" :to="item.to" class="nav-link" :aria-label="item.label">
        <component :is="item.icon" aria-hidden="true" />
        <span class="rail-tip" aria-hidden="true">{{ item.label }}</span>
      </NuxtLink>
    </nav>
    <div class="sidebar-spacer" />
    <button type="button" class="ask-button" aria-label="Ask Kobi" @click="open()">
      <Sparkles :size="20" aria-hidden="true" />
      <span class="rail-tip" aria-hidden="true">Ask Kobi</span>
    </button>
    <div class="sidebar-footer">
      <NuxtLink to="/settings" class="nav-link" aria-label="Settings">
        <Settings aria-hidden="true" />
        <span class="rail-tip" aria-hidden="true">Settings</span>
      </NuxtLink>
      <div class="user-chip">
        <span class="avatar" aria-hidden="true">{{ initials }}</span>
        <span class="user-meta rail-tip">
          <strong>{{ user?.name }}</strong>
          <span>{{ user?.email }}</span>
        </span>
      </div>
    </div>
  </aside>
</template>
