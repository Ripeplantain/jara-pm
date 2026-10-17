<script setup lang="ts">
definePageMeta({ layout: 'public', middleware: ['guest'] })
useSeoMeta({ title: 'Sign in · Kobi' })

const route = useRoute()
const { fetch: refreshSession } = useUserSession()
const email = ref('')
const password = ref('')
const isSubmitting = ref(false)
const errorMessage = ref('')

const submit = async () => {
  isSubmitting.value = true
  errorMessage.value = ''
  try {
    await $fetch('/api/auth/login', { method: 'POST', body: { email: email.value, password: password.value } })
    await refreshSession()
    const redirect = typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/')
      ? route.query.redirect
      : '/'
    await navigateTo(redirect)
  } catch {
    errorMessage.value = 'The email or password is not correct.'
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <section class="auth-card">
    <h1>Welcome back</h1>
    <p>Pick up where you left off.</p>
    <form class="form-grid" @submit.prevent="submit">
      <label class="field">
        <span>Email</span>
        <input v-model="email" type="email" class="input" autocomplete="email" required>
      </label>
      <label class="field">
        <span>Password</span>
        <input v-model="password" type="password" class="input" autocomplete="current-password" required>
      </label>
      <p v-if="errorMessage" class="form-error" role="alert">{{ errorMessage }}</p>
      <button type="submit" class="button" :disabled="isSubmitting">{{ isSubmitting ? 'Signing in…' : 'Sign in' }}</button>
    </form>
    <p class="auth-switch">New to Kobi? <NuxtLink to="/signup">Create an account</NuxtLink></p>
  </section>
</template>
