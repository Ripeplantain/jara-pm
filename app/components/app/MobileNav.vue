<script setup lang="ts">
import { CalendarDays, FolderKanban, Inbox, LayoutGrid, Target } from '@lucide/vue'

const links = [
  { label: 'Today', to: '/', icon: CalendarDays },
  { label: 'Inbox', to: '/inbox', icon: Inbox },
  { label: 'Goals', to: '/goals', icon: Target },
  { label: 'Projects', to: '/projects', icon: FolderKanban },
  { label: 'Board', to: '/board', icon: LayoutGrid },
  { label: 'Upcoming', to: '/upcoming', icon: CalendarDays },
]
</script>

<template>
  <nav class="mobile-nav" aria-label="Mobile navigation">
    <NuxtLink v-for="item in links" :key="item.to" :to="item.to">
      <component :is="item.icon" aria-hidden="true" />
      <span>{{ item.label }}</span>
    </NuxtLink>
  </nav>
</template>
