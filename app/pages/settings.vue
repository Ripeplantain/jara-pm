<script setup lang="ts">
import { LogOut, Moon, Sun } from '@lucide/vue'

definePageMeta({ middleware: ['authenticated'] })
useSeoMeta({ title: 'Settings · Kobi' })
const { user, clear } = useUserSession()
const { theme, toggle } = useTheme()
const { capture, reset } = useProductAnalytics()

const logout = async () => {
  capture('user_logged_out')
  reset()
  await clear()
  await navigateTo('/welcome')
}

const toggleTheme = () => {
  toggle()
  capture('theme_changed', { theme: theme.value === 'dark' ? 'light' : 'dark' })
}
</script>

<template>
  <main class="page narrow">
    <header class="page-header"><div><div class="eyebrow">Preferences</div><h1>Settings</h1><p>Only the controls that make Kobi feel like yours.</p></div></header>
    <section class="card card-pad">
      <div class="section-heading"><h2>Profile</h2></div>
      <div class="form-row"><div><span class="field-label">Name</span><p>{{ user?.name }}</p></div><div><span class="field-label">Email</span><p>{{ user?.email }}</p></div></div>
    </section>
    <section class="card card-pad section">
      <div class="section-heading"><h2>Appearance</h2></div>
      <button type="button" class="button secondary" @click="toggleTheme"><Sun v-if="theme === 'dark'" :size="16" /><Moon v-else :size="16" /> Use {{ theme === 'dark' ? 'light' : 'dark' }} mode</button>
    </section>
    <section class="card card-pad section">
      <div class="section-heading"><h2>Account</h2></div>
      <button type="button" class="button secondary" @click="logout"><LogOut :size="16" /> Sign out</button>
    </section>
  </main>
</template>
