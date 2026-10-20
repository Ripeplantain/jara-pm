<script setup lang="ts">
import { LogOut, Moon, Sun } from '@lucide/vue'
import type { WorkspaceMember } from '#shared/types/domain'
import { getUserFacingErrorMessage } from '#shared/utils/error-message'

definePageMeta({ middleware: ['authenticated'] })
useSeoMeta({ title: 'Settings · Kobi' })
const { user, clear } = useUserSession()
const { activeWorkspace } = useWorkspaces()
type PendingInvite = { id: string, email: string, expiresAt: string, lastSentAt: string | null }
const { theme, toggle } = useTheme()
const { capture, reset } = useProductAnalytics()
const members = ref<WorkspaceMember[]>([])
const invites = ref<PendingInvite[]>([])
const inviteEmail = ref('')
const inviteUrl = ref('')
const teamMessage = ref('')
const teamError = ref('')
const isTeamBusy = ref(false)
const isTeamLoading = ref(true)
const removingUserId = ref<string | null>(null)
const isOwner = computed(() => activeWorkspace.value?.role === 'owner')
const workspaceId = computed(() => activeWorkspace.value?.id ?? '')

const loadTeam = async () => {
  if (!workspaceId.value) return
  teamError.value = ''
  isTeamLoading.value = true
  try {
    members.value = await $fetch<WorkspaceMember[]>(`/api/workspaces/${workspaceId.value}/members`)
    invites.value = isOwner.value
      ? await $fetch<PendingInvite[]>(`/api/workspaces/${workspaceId.value}/invites`)
      : []
  } catch {
    teamError.value = 'Could not load the workspace team.'
  } finally {
    isTeamLoading.value = false
  }
}

onMounted(() => {
  watch(workspaceId, (id) => {
    if (id) loadTeam()
  }, { immediate: true })
})

const invite = async () => {
  if (!inviteEmail.value.trim()) return
  isTeamBusy.value = true
  teamMessage.value = ''
  teamError.value = ''
  try {
    const result = await $fetch<{ inviteUrl: string }>(`/api/workspaces/${workspaceId.value}/invites`, { method: 'POST', body: { email: inviteEmail.value } })
    inviteUrl.value = result.inviteUrl
    inviteEmail.value = ''
    teamMessage.value = 'Invite created. Copy the link or wait for the email.'
    await loadTeam()
    capture('invite_sent')
  } catch (error: unknown) {
    teamError.value = getUserFacingErrorMessage(error, 'Could not create the invite.')
  } finally {
    isTeamBusy.value = false
  }
}

const copyInvite = async () => {
  if (!inviteUrl.value) return
  await navigator.clipboard.writeText(inviteUrl.value)
  teamMessage.value = 'Invite link copied.'
}

const resend = async (id: string) => {
  try {
    const result = await $fetch<{ inviteUrl: string }>(`/api/workspaces/${workspaceId.value}/invites/${id}/resend`, { method: 'POST' })
    inviteUrl.value = result.inviteUrl
    teamMessage.value = 'Invite resent.'
    await loadTeam()
    capture('invite_resent')
  } catch (error: unknown) {
    teamError.value = getUserFacingErrorMessage(error, 'Could not resend the invite.')
  }
}

const revoke = async (id: string) => {
  try {
    await $fetch(`/api/workspaces/${workspaceId.value}/invites/${id}`, { method: 'DELETE' })
    await loadTeam()
    capture('invite_revoked')
  } catch (error: unknown) {
    teamError.value = getUserFacingErrorMessage(error, 'Could not revoke the invite.')
  }
}

const removeMember = async (userId: string) => {
  if (removingUserId.value !== userId) {
    removingUserId.value = userId
    return
  }
  try {
    await $fetch(`/api/workspaces/${workspaceId.value}/members/${userId}`, { method: 'DELETE' })
    removingUserId.value = null
    await loadTeam()
    capture('member_removed')
  } catch (error: unknown) {
    teamError.value = getUserFacingErrorMessage(error, 'Could not remove the member.')
  }
}

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
    <section v-if="activeWorkspace" class="card card-pad section">
      <div class="section-heading"><div><h2>Team</h2><p class="form-hint">{{ activeWorkspace.name }} · {{ activeWorkspace.role }}</p></div><span>{{ isTeamLoading ? 'Loading…' : `${members.length} members` }}</span></div>
      <form v-if="isOwner" class="form-row" @submit.prevent="invite">
        <label class="field"><span class="field-label">Invite by email</span><input v-model="inviteEmail" class="input" type="email" placeholder="teammate@example.com" required></label>
        <button type="submit" class="button secondary" :disabled="isTeamBusy">{{ isTeamBusy ? 'Sending…' : 'Invite' }}</button>
      </form>
      <div v-if="isOwner && inviteUrl" class="invite-link-row"><input :value="inviteUrl" class="input" readonly aria-label="Invite link"><button type="button" class="button secondary" @click="copyInvite">Copy link</button></div>
      <p v-if="teamMessage" class="form-hint">{{ teamMessage }}</p>
      <p v-if="teamError" class="form-error" role="alert">{{ teamError }}</p>
      <p v-if="isTeamLoading" class="form-hint" aria-live="polite">Loading workspace members…</p>
      <div v-else class="team-list">
        <div v-for="member in members" :key="member.userId" class="team-row"><div><strong>{{ member.name }}</strong><span class="form-hint">{{ member.email }} · {{ member.role }}</span></div><button v-if="isOwner && member.role !== 'owner'" type="button" class="button ghost small" @click="removeMember(member.userId)">{{ removingUserId === member.userId ? 'Remove now?' : 'Remove' }}</button></div>
        <div v-for="pending in invites" :key="pending.id" class="team-row"><div><strong>{{ pending.email }}</strong><span class="form-hint">Pending invite · expires {{ pending.expiresAt.slice(0, 10) }}</span></div><div class="inline-actions"><button type="button" class="button ghost small" @click="resend(pending.id)">Resend</button><button type="button" class="button ghost small" @click="revoke(pending.id)">Revoke</button></div></div>
      </div>
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
