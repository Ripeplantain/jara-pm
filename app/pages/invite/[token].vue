<script setup lang="ts">
import { getUserFacingErrorMessage } from '#shared/utils/error-message'

definePageMeta({ layout: 'public' })
const route = useRoute()
const token = computed(() => String(route.params.token))
const { user, loggedIn, fetch: refreshSession } = useUserSession()
const { reset: resetAskKobi } = useAskKobi()
const { data: invite, status, error } = await useFetch<{
  status: 'valid' | 'used' | 'revoked' | 'expired' | 'not_found'
  email?: string
  workspaceName?: string
  inviterName?: string
  maskedEmail?: string
}>(() => `/api/invites/${token.value}`, { key: `invite-${token.value}` })
const acceptError = ref('')
const accepting = ref(false)

const accept = async () => {
  if (!loggedIn.value) return navigateTo(`/signin?invite=${encodeURIComponent(token.value)}`)
  accepting.value = true
  acceptError.value = ''
  try {
    const result = await $fetch<{ workspaceId: string }>(`/api/invites/${token.value}/accept`, { method: 'POST' })
    notifyWorkspaceChanged(result.workspaceId)
    resetAskKobi()
    clearNuxtData()
    try {
      await refreshSession()
    } catch {
      // The authenticated account is unchanged; workspace caches are already invalidated.
    }
    await navigateTo('/')
    await refreshNuxtData()
  } catch (error: unknown) {
    acceptError.value = getUserFacingErrorMessage(error, 'Could not accept this invite.')
  } finally {
    accepting.value = false
  }
}
</script>

<template>
  <section class="auth-card">
    <LoadingState v-if="status === 'pending'" />
    <template v-else-if="invite?.status === 'valid'">
      <h1>Join {{ invite.workspaceName }}</h1>
      <p>{{ invite.inviterName }} invited {{ invite.maskedEmail }} to collaborate in Kobi.</p>
      <p v-if="loggedIn && user?.email !== invite.email" class="form-error">Sign in with {{ invite.maskedEmail }} to accept this invitation.</p>
      <button type="button" class="button" :disabled="accepting || (loggedIn && user?.email !== invite.email)" @click="accept">{{ loggedIn ? (accepting ? 'Joining…' : 'Accept invitation') : 'Sign in to accept' }}</button>
      <NuxtLink v-if="!loggedIn" class="button secondary" :to="`/signup?invite=${token}`">Create an account</NuxtLink>
      <p v-if="acceptError" class="form-error" role="alert">{{ acceptError }}</p>
    </template>
    <template v-else-if="invite?.status === 'used'"><h1>Invitation already used</h1><p>This invitation has already been accepted.</p></template>
    <template v-else-if="invite?.status === 'expired'"><h1>Invitation expired</h1><p>Ask the workspace owner to send a new invitation.</p></template>
    <template v-else-if="invite?.status === 'revoked'"><h1>Invitation revoked</h1><p>This invitation is no longer active.</p></template>
    <template v-else><h1>Invitation not found</h1><p>This invitation link is not valid.</p></template>
    <p v-if="error" class="form-error" role="alert">Could not load this invitation.</p>
  </section>
</template>
