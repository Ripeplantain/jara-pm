<script setup lang="ts">
definePageMeta({ layout: 'public', middleware: ['guest'] })
useSeoMeta({ title: 'Sign in · Kobi' })

const route = useRoute()
const { fetch: refreshSession } = useUserSession()
const { capture } = useProductAnalytics()
const email = ref('')
const password = ref('')
const isSubmitting = ref(false)
const errorMessage = ref('')
const inviteToken = computed(() => typeof route.query.invite === 'string' ? route.query.invite : '')
const invite = ref<{ email?: string } | null>(null)
const fetchInvite = $fetch as unknown as (url: string) => Promise<{ email?: string }>
if (inviteToken.value) {
  try { invite.value = await fetchInvite(`/api/invites/${inviteToken.value}`) } catch { /* keep the normal sign-in form */ }
}
if (invite.value?.email) email.value = invite.value.email

const submit = async () => {
  isSubmitting.value = true
  errorMessage.value = ''
  try {
    await $fetch('/api/auth/login', { method: 'POST', body: { email: email.value, password: password.value } })
    await refreshSession()
    const redirect = inviteToken.value ? `/invite/${inviteToken.value}` : typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/')
      ? route.query.redirect
      : '/'
    await navigateTo(redirect)
  } catch {
    capture('auth_login_failed', { method: 'password' })
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
        <input v-model="email" type="email" class="input" autocomplete="email" required :readonly="Boolean(invite?.email)">
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
