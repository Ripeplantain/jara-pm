<script setup lang="ts">
import { LogOut, Moon, Sun, Trash2 } from '@lucide/vue'
import type { EstimateScale, Label, LabelColor, WorkspaceMember } from '#shared/types/domain'
import { ESTIMATE_SCALES, LABEL_COLORS } from '#shared/types/domain'
import { estimateOptions } from '#shared/utils/estimates'
import { getUserFacingErrorMessage } from '#shared/utils/error-message'

definePageMeta({ middleware: ['authenticated'] })
useSeoMeta({ title: 'Settings · Kobi' })
const { user, clear } = useUserSession()
const { activeWorkspace } = useWorkspaces()
type PendingInvite = { id: string, email: string, expiresAt: string, lastSentAt: string | null }
const { theme, toggle } = useTheme()
const { capture, reset } = useProductAnalytics()
const { confirm: confirmAction } = useConfirmation()
const members = ref<WorkspaceMember[]>([])
const invites = ref<PendingInvite[]>([])
const inviteEmail = ref('')
const inviteUrl = ref('')
const teamMessage = ref('')
const teamError = ref('')
const isTeamBusy = ref(false)
const isTeamLoading = ref(true)
const removingUserId = ref<string | null>(null)
const revokingInviteId = ref<string | null>(null)
const deletingLabelId = ref<string | null>(null)
const isLoggingOut = ref(false)
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

const revoke = async (pending: PendingInvite) => {
  const accepted = await confirmAction({
    title: 'Revoke this invitation?',
    message: `${pending.email} will no longer be able to join this workspace with the current invitation.`,
    confirmLabel: 'Revoke invitation',
  })
  if (!accepted) return

  revokingInviteId.value = pending.id
  try {
    await $fetch(`/api/workspaces/${workspaceId.value}/invites/${pending.id}`, { method: 'DELETE' })
    await loadTeam()
    capture('invite_revoked')
  } catch (error: unknown) {
    teamError.value = getUserFacingErrorMessage(error, 'Could not revoke the invite.')
  } finally {
    revokingInviteId.value = null
  }
}

const removeMember = async (member: WorkspaceMember) => {
  const accepted = await confirmAction({
    title: 'Remove this workspace member?',
    message: `${member.name} (${member.email}) will lose access to this workspace.`,
    confirmLabel: 'Remove member',
  })
  if (!accepted) return

  removingUserId.value = member.userId
  try {
    await $fetch(`/api/workspaces/${workspaceId.value}/members/${member.userId}`, { method: 'DELETE' })
    await loadTeam()
    capture('member_removed')
  } catch (error: unknown) {
    teamError.value = getUserFacingErrorMessage(error, 'Could not remove the member.')
  } finally {
    removingUserId.value = null
  }
}

const logout = async () => {
  const accepted = await confirmAction({
    title: 'Sign out of Kobi?',
    message: 'You will need to sign in again to access your workspace.',
    confirmLabel: 'Sign out',
  })
  if (!accepted) return

  isLoggingOut.value = true
  try {
    capture('user_logged_out')
    reset()
    await clear()
    await navigateTo('/welcome')
  } finally {
    isLoggingOut.value = false
  }
}

const chooseTheme = (value: 'light' | 'dark') => {
  if (theme.value === value) return
  toggle()
  capture('theme_changed', { theme: value })
}

// --- workspace identifier and estimate scale ---------------------------------------------

const { refresh: refreshWorkspaces } = useWorkspaces()
const workspaceForm = reactive({ key: '', estimateScale: 'none' as EstimateScale })
const workspaceMessage = ref('')
const workspaceError = ref('')
const isWorkspaceBusy = ref(false)

watch(activeWorkspace, (workspace) => {
  if (!workspace) return
  workspaceForm.key = workspace.key
  workspaceForm.estimateScale = workspace.estimateScale
}, { immediate: true })

const scaleExample = computed(() => {
  const options = estimateOptions(workspaceForm.estimateScale)
  return options.length ? options.map(option => option.label).join(' · ') : 'Estimates are hidden'
})

const saveWorkspace = async () => {
  isWorkspaceBusy.value = true
  workspaceMessage.value = ''
  workspaceError.value = ''
  try {
    await $fetch('/api/workspace', {
      method: 'PATCH',
      body: { key: workspaceForm.key, estimateScale: workspaceForm.estimateScale },
    })
    // Task keys are rendered from the workspace, so every cached list has to be re-read.
    await refreshWorkspaces()
    await refreshNuxtData()
    workspaceMessage.value = 'Workspace updated.'
    capture('workspace_identifiers_saved', { scale: workspaceForm.estimateScale })
  } catch (error: unknown) {
    workspaceError.value = getUserFacingErrorMessage(error, 'Could not update the workspace.')
    if (activeWorkspace.value) workspaceForm.key = activeWorkspace.value.key
  } finally {
    isWorkspaceBusy.value = false
  }
}

// --- labels -------------------------------------------------------------------------------

const {
  groups: labelGroups,
  labels: allLabels,
  inGroup,
  ungrouped,
  createLabel,
  createGroup,
  updateLabel,
  removeLabel,
} = useLabels()
const labelForm = reactive({ name: '', color: 'slate' as LabelColor, groupId: '' })
const groupName = ref('')
const labelMessage = ref('')
const labelError = ref('')
const isLabelBusy = ref(false)
const showArchivedLabels = ref(false)
const archivedLabels = ref<Array<{ id: string, name: string }>>([])

const loadArchived = async () => {
  const collection = await $fetch<{ labels: Array<{ id: string, name: string, archivedAt: string | null }> }>(
    '/api/labels',
    { query: { includeArchived: true } },
  )
  archivedLabels.value = collection.labels.filter(label => label.archivedAt !== null)
}

const addLabel = async () => {
  if (!labelForm.name.trim()) return
  isLabelBusy.value = true
  labelMessage.value = ''
  labelError.value = ''
  try {
    await createLabel({ name: labelForm.name, color: labelForm.color, groupId: labelForm.groupId || null })
    labelForm.name = ''
    labelMessage.value = 'Label created.'
  } catch (error: unknown) {
    labelError.value = getUserFacingErrorMessage(error, 'Could not create that label.')
  } finally {
    isLabelBusy.value = false
  }
}

const addGroup = async () => {
  if (!groupName.value.trim()) return
  isLabelBusy.value = true
  labelError.value = ''
  try {
    await createGroup(groupName.value)
    groupName.value = ''
    labelMessage.value = 'Group created. Labels inside a group are single-select.'
  } catch (error: unknown) {
    labelError.value = getUserFacingErrorMessage(error, 'Could not create that group.')
  } finally {
    isLabelBusy.value = false
  }
}

const archiveLabel = async (id: string) => {
  labelError.value = ''
  try {
    await updateLabel(id, { archived: true })
    labelMessage.value = 'Label archived. It stays on the tasks that already carry it.'
    if (showArchivedLabels.value) await loadArchived()
  } catch (error: unknown) {
    labelError.value = getUserFacingErrorMessage(error, 'Could not archive that label.')
  }
}

const restoreLabel = async (id: string) => {
  labelError.value = ''
  try {
    await updateLabel(id, { archived: false })
    await loadArchived()
    labelMessage.value = 'Label restored.'
  } catch (error: unknown) {
    labelError.value = getUserFacingErrorMessage(error, 'Could not restore that label.')
  }
}

const deleteLabel = async (label: Label) => {
  labelError.value = ''
  const accepted = await confirmAction({
    title: `Delete “${label.name}”?`,
    message: 'This label will be permanently removed from every task. Archiving is the reversible alternative.',
    confirmLabel: 'Delete label',
  })
  if (!accepted) return

  deletingLabelId.value = label.id
  try {
    await removeLabel(label.id)
    labelMessage.value = 'Label deleted and removed from every task.'
    if (showArchivedLabels.value) await loadArchived()
  } catch (error: unknown) {
    labelError.value = getUserFacingErrorMessage(error, 'Could not delete that label.')
  } finally {
    deletingLabelId.value = null
  }
}

const toggleArchivedLabels = async () => {
  showArchivedLabels.value = !showArchivedLabels.value
  if (showArchivedLabels.value) await loadArchived()
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
        <div v-for="member in members" :key="member.userId" class="team-row"><div><strong>{{ member.name }}</strong><span class="form-hint">{{ member.email }} · {{ member.role }}</span></div><button v-if="isOwner && member.role !== 'owner'" type="button" class="button ghost small" :disabled="removingUserId === member.userId" @click="removeMember(member)">{{ removingUserId === member.userId ? 'Removing…' : 'Remove' }}</button></div>
        <div v-for="pending in invites" :key="pending.id" class="team-row"><div><strong>{{ pending.email }}</strong><span class="form-hint">Pending invite · expires {{ pending.expiresAt.slice(0, 10) }}</span></div><div class="inline-actions"><button type="button" class="button ghost small" @click="resend(pending.id)">Resend</button><button type="button" class="button ghost small" :disabled="revokingInviteId === pending.id" @click="revoke(pending)">{{ revokingInviteId === pending.id ? 'Revoking…' : 'Revoke' }}</button></div></div>
      </div>
    </section>
    <section v-if="activeWorkspace && isOwner" class="card card-pad section">
      <div class="section-heading"><div><h2>Identifiers and estimates</h2><p class="form-hint">Tasks read as {{ workspaceForm.key || activeWorkspace.key }}-1, {{ workspaceForm.key || activeWorkspace.key }}-2, and so on.</p></div></div>
      <form class="form-row" @submit.prevent="saveWorkspace">
        <label class="field">
          <span class="field-label">Workspace key</span>
          <input v-model="workspaceForm.key" class="input" maxlength="5" pattern="[A-Za-z][A-Za-z0-9]{0,4}" required aria-describedby="workspace-key-hint">
          <span id="workspace-key-hint" class="form-hint">1–5 letters or digits, starting with a letter. Existing task numbers do not change.</span>
        </label>
        <label class="field">
          <span class="field-label">Estimate scale</span>
          <select v-model="workspaceForm.estimateScale" class="input">
            <option v-for="scale in ESTIMATE_SCALES" :key="scale" :value="scale">{{ scale }}</option>
          </select>
          <span class="form-hint">{{ scaleExample }}</span>
        </label>
        <button type="submit" class="button secondary" :disabled="isWorkspaceBusy">{{ isWorkspaceBusy ? 'Saving…' : 'Save' }}</button>
      </form>
      <p v-if="workspaceMessage" class="form-hint">{{ workspaceMessage }}</p>
      <p v-if="workspaceError" class="form-error" role="alert">{{ workspaceError }}</p>
    </section>

    <StatusEditor v-if="activeWorkspace && isOwner" />

    <section v-if="activeWorkspace" class="card card-pad section">
      <div class="section-heading"><div><h2>Labels</h2><p class="form-hint">Labels in a group are single-select; ungrouped labels are multi-select.</p></div><span>{{ allLabels.length }} active</span></div>

      <form class="form-row" @submit.prevent="addLabel">
        <label class="field"><span class="field-label">New label</span><input v-model="labelForm.name" class="input" placeholder="bug" maxlength="60" required></label>
        <label class="field">
          <span class="field-label">Colour</span>
          <select v-model="labelForm.color" class="input">
            <option v-for="color in LABEL_COLORS" :key="color" :value="color">{{ color }}</option>
          </select>
        </label>
        <label class="field">
          <span class="field-label">Group</span>
          <select v-model="labelForm.groupId" class="input">
            <option value="">No group (multi-select)</option>
            <option v-for="group in labelGroups" :key="group.id" :value="group.id">{{ group.name }}</option>
          </select>
        </label>
        <button type="submit" class="button secondary" :disabled="isLabelBusy">Add label</button>
      </form>

      <form class="form-row" @submit.prevent="addGroup">
        <label class="field"><span class="field-label">New group</span><input v-model="groupName" class="input" placeholder="Type" maxlength="60"></label>
        <button type="submit" class="button ghost small" :disabled="isLabelBusy">Add group</button>
      </form>

      <div class="team-list">
        <div v-for="group in labelGroups" :key="group.id" class="label-admin-row">
          <div><strong>{{ group.name }}</strong><span class="form-hint">Single-select · {{ inGroup(group.id).length }} labels</span></div>
          <div class="task-labels">
            <span v-for="label in inGroup(group.id)" :key="label.id" class="inline-actions">
              <LabelChip :label="label" />
              <button type="button" class="button ghost small" :aria-label="`Archive ${label.name}`" @click="archiveLabel(label.id)">Archive</button>
              <button v-if="isOwner" type="button" class="button ghost small" :disabled="deletingLabelId === label.id" :aria-label="`Delete ${label.name}`" @click="deleteLabel(label)"><span v-if="deletingLabelId === label.id">Deleting…</span><Trash2 v-else :size="14" aria-hidden="true" /></button>
            </span>
          </div>
        </div>

        <div v-if="ungrouped.length" class="label-admin-row">
          <div><strong>Ungrouped</strong><span class="form-hint">Multi-select · {{ ungrouped.length }} labels</span></div>
          <div class="task-labels">
            <span v-for="label in ungrouped" :key="label.id" class="inline-actions">
              <LabelChip :label="label" />
              <button type="button" class="button ghost small" :aria-label="`Archive ${label.name}`" @click="archiveLabel(label.id)">Archive</button>
              <button v-if="isOwner" type="button" class="button ghost small" :disabled="deletingLabelId === label.id" :aria-label="`Delete ${label.name}`" @click="deleteLabel(label)"><span v-if="deletingLabelId === label.id">Deleting…</span><Trash2 v-else :size="14" aria-hidden="true" /></button>
            </span>
          </div>
        </div>
      </div>

      <button type="button" class="button ghost small" @click="toggleArchivedLabels">
        {{ showArchivedLabels ? 'Hide' : 'Show' }} archived labels
      </button>
      <div v-if="showArchivedLabels" class="team-list">
        <p v-if="!archivedLabels.length" class="form-hint">No archived labels.</p>
        <div v-for="label in archivedLabels" :key="label.id" class="label-admin-row">
          <strong>{{ label.name }}</strong>
          <button type="button" class="button ghost small" @click="restoreLabel(label.id)">Restore</button>
        </div>
      </div>

      <p v-if="labelMessage" class="form-hint">{{ labelMessage }}</p>
      <p v-if="labelError" class="form-error" role="alert">{{ labelError }}</p>
    </section>

    <section class="card card-pad section">
      <div class="section-heading"><h2>Appearance</h2></div>
      <div class="stack-actions" role="group" aria-label="Theme">
        <button type="button" class="button secondary" :aria-pressed="theme === 'light'" @click="chooseTheme('light')"><Sun :size="16" aria-hidden="true" /> Light</button>
        <button type="button" class="button secondary" :aria-pressed="theme === 'dark'" @click="chooseTheme('dark')"><Moon :size="16" aria-hidden="true" /> Dark</button>
      </div>
    </section>
    <section class="card card-pad section">
      <div class="section-heading"><h2>Account</h2></div>
      <button type="button" class="button secondary" :disabled="isLoggingOut" @click="logout"><LogOut :size="16" /> {{ isLoggingOut ? 'Signing out…' : 'Sign out' }}</button>
    </section>
  </main>
</template>
