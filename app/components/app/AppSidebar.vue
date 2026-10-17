<script setup lang="ts">
import { CalendarDays, CirclePlus, Inbox, Settings, Sparkles, Target } from '@lucide/vue'

const { user } = useUserSession()
const { open } = useAskKobi()

const navigation = [
  { label: 'Today', to: '/', icon: CalendarDays },
  { label: 'Inbox', to: '/inbox', icon: Inbox },
  { label: 'Goals', to: '/goals', icon: Target },
  { label: 'Projects', to: '/projects', icon: CirclePlus },
  { label: 'Upcoming', to: '/upcoming', icon: CalendarDays },
]

const initials = computed(() => user.value?.name.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase() ?? 'K')
</script>

<template>
  <aside class="app-sidebar" aria-label="Primary navigation">
    <AppLogo />
    <nav class="sidebar-nav">
      <NuxtLink v-for="item in navigation" :key="item.to" :to="item.to" class="nav-link">
        <component :is="item.icon" aria-hidden="true" />
        <span>{{ item.label }}</span>
      </NuxtLink>
    </nav>
    <div class="sidebar-spacer" />
    <button type="button" class="ask-button" @click="open()">
      <Sparkles :size="17" aria-hidden="true" />
      Ask Kobi
    </button>
    <div class="sidebar-footer">
      <NuxtLink to="/settings" class="nav-link">
        <Settings aria-hidden="true" />
        <span>Settings</span>
      </NuxtLink>
      <div class="user-chip">
        <span class="avatar">{{ initials }}</span>
        <span class="user-meta">
          <strong>{{ user?.name }}</strong>
          <span>{{ user?.email }}</span>
        </span>
      </div>
    </div>
  </aside>
</template>
