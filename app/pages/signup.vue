<script setup lang="ts">
import { getUserFacingErrorMessage } from '#shared/utils/error-message'

definePageMeta({ layout: 'public', middleware: ['guest'] })
useSeoMeta({ title: 'Create an account · Kobi' })

const { fetch: refreshSession } = useUserSession()
const { capture } = useProductAnalytics()
const name = ref('')
const email = ref('')
const password = ref('')
const isSubmitting = ref(false)
const errorMessage = ref('')

const submit = async () => {
  isSubmitting.value = true
  errorMessage.value = ''
  try {
    await $fetch('/api/auth/register', {
      method: 'POST', body: { name: name.value, email: email.value, password: password.value },
    })
    await refreshSession()
    await navigateTo('/')
  } catch (error: unknown) {
    capture('auth_signup_failed', { method: 'password' })
    errorMessage.value = getUserFacingErrorMessage(error, 'Could not create the account.', {
      validation: 'Please check your name, email, and password and try again.',
      unavailable: 'We could not create your account right now. Please try again in a moment.',
    })
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <section class="auth-card">
    <h1>Make progress feel lighter</h1>
    <p>Create your workspace in less than a minute.</p>
    <form class="form-grid" @submit.prevent="submit">
      <label class="field">
        <span>Name</span>
        <input v-model="name" class="input" autocomplete="name" required>
      </label>
      <label class="field">
        <span>Email</span>
        <input v-model="email" type="email" class="input" autocomplete="email" required>
      </label>
      <label class="field">
        <span>Password</span>
        <input v-model="password" type="password" class="input" autocomplete="new-password" minlength="8" required>
        <span class="form-hint">At least 8 characters.</span>
      </label>
      <p v-if="errorMessage" class="form-error" role="alert">{{ errorMessage }}</p>
      <button type="submit" class="button" :disabled="isSubmitting">{{ isSubmitting ? 'Creating account…' : 'Create account' }}</button>
    </form>
    <p class="auth-switch">Already have an account? <NuxtLink to="/signin">Sign in</NuxtLink></p>
  </section>
</template>
