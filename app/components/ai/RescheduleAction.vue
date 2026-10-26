<script setup lang="ts">
import { Check, Sparkles, Undo2, X } from '@lucide/vue'
import type { RescheduleReply, Task } from '#shared/types/domain'
import { getUserFacingErrorMessage } from '#shared/utils/error-message'

const props = defineProps<{ tasks: Task[] }>()
const emit = defineEmits<{ accepted: [] }>()
const { refreshTaskViews } = useTaskViews()
const { captureException } = useProductAnalytics()
const { show, showUndo } = useToasts()
const reply = ref<RescheduleReply | null>(null)
const draft = ref<RescheduleDraft | null>(null)
const isRequesting = ref(false)
const isResolving = ref(false)
const errorMessage = ref('')
const appliedProposalId = ref<string | null>(null)
const isUndoing = ref(false)
const issue = computed(() => (draft.value ? firstRescheduleIssue(draft.value) : ''))
const dialog = useTemplateRef<HTMLElement>('dialog')

const request = async () => {
  if (isRequesting.value) return
  isRequesting.value = true
  errorMessage.value = ''
  try {
    const result = await $fetch<RescheduleReply>('/api/ai/reschedule', { method: 'POST', body: {} })
    reply.value = result
    draft.value = result.proposal ? toRescheduleDraft(result.proposal) : null
    await nextTick()
    dialog.value?.focus()
  } catch (error: unknown) {
    captureException(error, { flow: 'ask_kobi_reschedule' })
    errorMessage.value = getUserFacingErrorMessage(error, 'Kobi could not replan the overdue work.')
  } finally { isRequesting.value = false }
}

const resolve = async (accept: boolean) => {
  if (!reply.value?.proposalId || isResolving.value) return
  isResolving.value = true
  errorMessage.value = ''
  try {
    if (accept && draft.value) {
      const proposalId = reply.value.proposalId
      await $fetch(`/api/ai/proposals/${proposalId}/accept`, {
        method: 'POST', body: { proposal: toRescheduleProposal(draft.value) },
      })
      await refreshTaskViews()
      appliedProposalId.value = proposalId
      showUndo({
        message: 'Replan applied',
        actionLabel: 'Undo',
        delayMs: 10_000,
        onCommit: () => {},
        onUndo: undoReplan,
      })
      emit('accepted')
    } else {
      await $fetch(`/api/ai/proposals/${reply.value.proposalId}/reject`, { method: 'POST' })
    }
    reply.value = null
    draft.value = null
  } catch (error: unknown) {
    captureException(error, { flow: accept ? 'ask_kobi_reschedule_accept' : 'ask_kobi_reschedule_reject' })
    errorMessage.value = getUserFacingErrorMessage(error, accept ? 'The overdue work could not be updated.' : 'The suggestion could not be dismissed.')
  } finally { isResolving.value = false }
}

// The server refuses (409) when any task changed since the replan, and that message is shown as is.
async function undoReplan() {
  const proposalId = appliedProposalId.value
  if (!proposalId || isUndoing.value) return
  isUndoing.value = true
  errorMessage.value = ''
  try {
    await $fetch(`/api/ai/proposals/${proposalId}/undo`, { method: 'POST' })
    appliedProposalId.value = null
    await refreshTaskViews()
    emit('accepted')
  } catch (error: unknown) {
    captureException(error, { flow: 'ask_kobi_reschedule_undo' })
    const detail = (error as { data?: { message?: string, statusMessage?: string } } | null)?.data
    errorMessage.value = getUserFacingErrorMessage(error, 'The replan could not be undone.', {
      conflict: detail?.message ?? detail?.statusMessage ?? 'Those tasks changed after the replan, so it cannot be undone.',
    })
    // The overdue section can unmount once a replan clears it, taking errorMessage with it.
    show(errorMessage.value)
  } finally { isUndoing.value = false }
}

const dismiss = async () => {
  if (reply.value?.proposalId) await resolve(false)
  else {
    reply.value = null
    draft.value = null
  }
}
</script>

<template>
  <div class="ai-action reschedule-action">
    <button v-if="!reply" type="button" class="button secondary small" :disabled="isRequesting" @click="request"><Sparkles :size="14" /> {{ isRequesting ? 'Planning…' : 'Replan overdue work' }}</button>
    <template v-else>
      <div class="reschedule-overlay" aria-hidden="true" @click="dismiss" />
      <div ref="dialog" class="ai-proposal-card" role="dialog" aria-modal="true" aria-label="Review overdue work replan" tabindex="-1" @keydown.esc="dismiss">
        <div class="ai-proposal-heading">
          <span class="status-badge" :class="{ active: reply.source === 'model' }">{{ reply.source === 'model' ? 'Reschedule preview' : reply.source === 'offline' ? 'Offline' : 'Reply error' }}</span>
          <button type="button" class="icon-button" aria-label="Reject and close reschedule suggestion" :disabled="isResolving" @click="dismiss"><X :size="15" /></button>
        </div>
        <span v-if="reply.source === 'offline' && draft" class="status-badge">Offline draft</span>
        <p>{{ reply.message }}</p>
        <template v-if="draft">
          <AiReschedulePreview v-model="draft" :tasks="props.tasks" />
          <p v-if="issue" class="form-error" role="alert">{{ issue }}</p>
          <div class="inline-actions"><button type="button" class="button small" :disabled="isResolving || Boolean(issue)" @click="resolve(true)"><Check :size="14" /> {{ isResolving ? 'Saving…' : 'Accept replan' }}</button><button type="button" class="button ghost small" :disabled="isResolving" @click="resolve(false)">Reject</button></div>
        </template>
        <button v-else type="button" class="button ghost small" :disabled="isRequesting" @click="request">Try again</button>
      </div>
    </template>
    <p v-if="appliedProposalId && !reply" class="form-hint reschedule-applied">Replan applied · <button type="button" class="button ghost small" :disabled="isUndoing" @click="undoReplan"><Undo2 :size="14" /> {{ isUndoing ? 'Undoing…' : 'Undo' }}</button></p>
    <p v-if="errorMessage" class="form-error" role="alert">{{ errorMessage }}</p>
  </div>
</template>
