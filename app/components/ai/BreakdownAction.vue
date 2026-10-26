<script setup lang="ts">
import { Check, Sparkles, X } from '@lucide/vue'
import type { BreakdownReply } from '#shared/types/domain'
import { getUserFacingErrorMessage } from '#shared/utils/error-message'

const props = defineProps<{ projectId: string }>()
const emit = defineEmits<{ accepted: [] }>()
const { refreshTaskViews } = useTaskViews()
const { captureException } = useProductAnalytics()
const reply = ref<BreakdownReply | null>(null)
const draft = ref<BreakdownDraft | null>(null)
const isRequesting = ref(false)
const isResolving = ref(false)
const errorMessage = ref('')
const issue = computed(() => (draft.value ? firstBreakdownIssue(draft.value) : ''))
const dialog = useTemplateRef<HTMLElement>('dialog')

const request = async () => {
  if (isRequesting.value) return
  isRequesting.value = true
  errorMessage.value = ''
  try {
    const result = await $fetch<BreakdownReply>('/api/ai/breakdown', { method: 'POST', body: { projectId: props.projectId } })
    reply.value = result
    draft.value = result.proposal ? toBreakdownDraft(result.proposal) : null
    await nextTick()
    dialog.value?.focus()
  } catch (error: unknown) {
    captureException(error, { flow: 'ask_kobi_breakdown' })
    errorMessage.value = getUserFacingErrorMessage(error, 'Kobi could not break this project down.', {
      unprocessable: 'Archived projects cannot be broken down. Unarchive it first.',
    })
  } finally { isRequesting.value = false }
}

const resolve = async (accept: boolean) => {
  if (!reply.value?.proposalId || isResolving.value) return
  isResolving.value = true
  errorMessage.value = ''
  try {
    if (accept && draft.value) {
      await $fetch(`/api/ai/proposals/${reply.value.proposalId}/accept`, {
        method: 'POST', body: { proposal: toBreakdownProposal(draft.value) },
      })
      await refreshTaskViews()
      emit('accepted')
    } else {
      await $fetch(`/api/ai/proposals/${reply.value.proposalId}/reject`, { method: 'POST' })
    }
    reply.value = null
    draft.value = null
  } catch (error: unknown) {
    captureException(error, { flow: accept ? 'ask_kobi_breakdown_accept' : 'ask_kobi_breakdown_reject' })
    errorMessage.value = getUserFacingErrorMessage(error, accept ? 'The breakdown could not be saved.' : 'The suggestion could not be dismissed.', {
      unprocessable: 'This project can no longer be broken down. Refresh and try again.',
    })
  } finally { isResolving.value = false }
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
  <div class="ai-action breakdown-action">
    <button v-if="!reply" type="button" class="button secondary" :disabled="isRequesting" @click="request"><Sparkles :size="16" /> {{ isRequesting ? 'Thinking…' : 'Break down with Kobi' }}</button>
    <template v-else>
      <div class="reschedule-overlay" aria-hidden="true" @click="dismiss" />
      <div ref="dialog" class="ai-proposal-card" role="dialog" aria-modal="true" aria-label="Review project breakdown" tabindex="-1" @keydown.esc="dismiss">
        <div class="ai-proposal-heading">
          <span class="status-badge" :class="{ active: reply.source === 'model' }">{{ reply.source === 'model' ? 'Breakdown preview' : reply.source === 'offline' ? 'Offline' : 'Reply error' }}</span>
          <button type="button" class="icon-button" aria-label="Reject and close breakdown suggestion" :disabled="isResolving" @click="dismiss"><X :size="15" /></button>
        </div>
        <p>{{ reply.message }}</p>
        <template v-if="draft">
          <fieldset class="proposal-fieldset" :disabled="isResolving">
            <MilestoneTreeEditor v-model="draft.milestones" />
          </fieldset>
          <p v-if="issue" class="form-error" role="alert">{{ issue }}</p>
          <div class="inline-actions"><button type="button" class="button small" :disabled="isResolving || Boolean(issue)" @click="resolve(true)"><Check :size="14" /> {{ isResolving ? 'Saving…' : 'Accept breakdown' }}</button><button type="button" class="button ghost small" :disabled="isResolving" @click="resolve(false)">Reject</button></div>
        </template>
        <button v-else type="button" class="button ghost small" :disabled="isRequesting" @click="request">Try again</button>
      </div>
    </template>
    <p v-if="errorMessage" class="form-error" role="alert">{{ errorMessage }}</p>
  </div>
</template>
