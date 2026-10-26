<script setup lang="ts">
import { ArrowUp, Check, Sparkles } from '@lucide/vue'
import { MAX_AI_MESSAGE_LENGTH } from '#shared/schemas/ai'
import type { AiReply, AiReplySource, GoalPlanProposal } from '#shared/types/domain'
import { getUserFacingErrorMessage } from '#shared/utils/error-message'

// The one Ask Kobi conversation: messages, composer and proposal review. The side panel and the
// full-screen /ask page both render this, so there is a single send/accept flow. `panel` renders
// the body and composer as grid rows of the panel; `page` adds starters and a two-column body.
const props = withDefaults(defineProps<{ layout?: 'panel' | 'page' }>(), { layout: 'panel' })
const emit = defineEmits<{ navigate: [] }>()

const input = ref('')
const isSending = ref(false)
const isAccepting = ref(false)
const errorMessage = ref('')
const messages = ref<Array<{ role: 'user' | 'assistant', content: string, source?: AiReplySource }>>([])
const proposal = ref<GoalPlanProposal | null>(null)
const proposalId = ref<string | null>(null)
// Editable mirror of `proposal`; `proposal` itself stays the model's original output.
const planDraft = ref<DraftPlan | null>(null)
// Serialized snapshot of the untouched draft. Dirtiness is derived by comparing values
// rather than by listening for edit events, because a missed event would show the user
// their edits while the server quietly persisted the model's original plan. Both sides
// go through toPlan(), so the comparison never depends on key order.
const planBaseline = ref('')
const isDirty = computed(() => {
  const draftPlan = planDraft.value
  if (!draftPlan) return false
  return JSON.stringify(toPlan(draftPlan)) !== planBaseline.value
})
const planIssue = computed(() => (planDraft.value ? firstPlanIssue(planDraft.value) : ''))
const acceptedGoalId = ref<string | null>(null)
const isOfflineProposal = ref(false)
const composer = useTemplateRef<HTMLTextAreaElement>('composer')
const { draft, isOpen, close } = useAskKobi()
const { captureException } = useProductAnalytics()
const { refreshTaskViews } = useTaskViews()

const starters = [
  { label: 'Plan a goal', message: 'Help me create a goal plan' },
  { label: 'Break down a project', message: 'Help me break down a project' },
  { label: 'Replan overdue tasks', message: 'Help me reschedule my overdue tasks' },
  { label: 'Triage my inbox', message: 'Help me triage my inbox' },
]

// Prompts handed over through `open(message)` (or a starter) land in the composer, never in a
// request: nothing is sent until the person submits.
const takeDraft = () => {
  if (!draft.value) return
  input.value = draft.value
  draft.value = ''
  composer.value?.focus()
}

onMounted(() => {
  takeDraft()
  composer.value?.focus()
})
watch(draft, takeDraft)
// On the full page the side panel must not also open: a later open() is absorbed here.
watch(isOpen, (value) => {
  if (value && props.layout === 'page') close()
}, { immediate: true })

const send = async () => {
  const message = input.value.trim()
  if (!message || isSending.value) return
  if (message.length > MAX_AI_MESSAGE_LENGTH) {
    errorMessage.value = `Your message is too long. Please keep it to ${MAX_AI_MESSAGE_LENGTH.toLocaleString()} characters or fewer.`
    return
  }
  messages.value.push({ role: 'user', content: message })
  input.value = ''
  isSending.value = true
  errorMessage.value = ''
  try {
    const reply = await $fetch<AiReply>('/api/ai/ask', { method: 'POST', body: { message } })
    messages.value.push({ role: 'assistant', content: reply.message, source: reply.source })
    proposal.value = reply.proposal
    planDraft.value = reply.proposal ? toDraft(reply.proposal) : null
    planBaseline.value = planDraft.value ? JSON.stringify(toPlan(planDraft.value)) : ''
    proposalId.value = reply.proposalId
    // Any message can now return a proposal, so a stale accepted id would
    // render "View saved goal" over the new plan's Accept button.
    acceptedGoalId.value = null
    isOfflineProposal.value = reply.source === 'offline'
  } catch (error: unknown) {
    captureException(error, { flow: 'ask_kobi_message' })
    errorMessage.value = getUserFacingErrorMessage(error, 'Kobi could not respond.', {
      validation: `Your message is too long. Please keep it to ${MAX_AI_MESSAGE_LENGTH.toLocaleString()} characters or fewer.`,
    })
  } finally {
    isSending.value = false
  }
}

const accept = async () => {
  if (!proposalId.value || isAccepting.value || planIssue.value) return
  isAccepting.value = true
  try {
    const result = await $fetch<{ goalId: string }>(`/api/ai/proposals/${proposalId.value}/accept`, {
      method: 'POST',
      // Always a body object; `plan` only when the user changed something.
      body: isDirty.value && planDraft.value ? { plan: toPlan(planDraft.value) } : {},
    })
    acceptedGoalId.value = result.goalId
    proposalId.value = null
    messages.value.push({ role: 'assistant', content: 'Your plan is saved. I created the goal, projects, milestones, and tasks.' })
    void refreshTaskViews()
  } catch (error: unknown) {
    captureException(error, { flow: 'ask_kobi_plan_accept' })
    errorMessage.value = getUserFacingErrorMessage(error, 'The plan could not be saved.')
  } finally {
    isAccepting.value = false
  }
}

// Dismiss leaves the plan unsaved and clears the review; the model's reply stays in the thread.
const dismiss = () => {
  proposal.value = null
  planDraft.value = null
  planBaseline.value = ''
  proposalId.value = null
  isOfflineProposal.value = false
}

const composerRows = computed(() => (props.layout === 'page' ? 3 : 1))
</script>

<template>
  <div class="ask-conversation" :class="`is-${layout}`">
    <section v-if="layout === 'page'" class="ask-starters" aria-labelledby="ask-starters-title">
      <h2 id="ask-starters-title" class="sr-only">Choose a starting point</h2>
      <ul class="ask-dock-chips">
        <li v-for="item in starters" :key="item.label">
          <button type="button" class="ask-dock-chip" @click="draft = item.message">{{ item.label }}</button>
        </li>
      </ul>
    </section>

    <form v-if="layout === 'page'" class="ask-composer" @submit.prevent="send">
      <div class="ask-input">
        <textarea ref="composer" v-model="input" :rows="composerRows" :maxlength="MAX_AI_MESSAGE_LENGTH" placeholder="Ask a question, or say what you want to achieve" aria-label="Message Kobi" aria-describedby="ask-message-counter" @keydown.enter.exact.prevent="send" />
        <button type="submit" class="button small" :disabled="!input.trim() || isSending" aria-label="Send message"><ArrowUp :size="16" /></button>
      </div>
      <div class="mt-1 flex justify-between gap-3">
        <span class="form-hint">Kobi proposes. Nothing is saved until you accept.</span>
        <span id="ask-message-counter" class="form-hint" aria-live="polite">{{ input.length.toLocaleString() }} / {{ MAX_AI_MESSAGE_LENGTH.toLocaleString() }} characters</span>
      </div>
    </form>

    <div class="ask-body" aria-live="polite">
      <div class="ask-thread">
        <div v-if="messages.length === 0" class="ask-intro">
          <span class="brand-mark"><Sparkles :size="16" /></span>
          <strong>What would make progress easier?</strong>
          <p>Ask what to focus on, or let Kobi draft a goal plan for you to review.</p>
        </div>
        <div v-for="(message, index) in messages" :key="index" class="message" :class="message.role">
          <span v-if="message.source === 'offline' || message.source === 'invalid'" class="status-badge message-badge">{{ message.source === 'offline' ? 'Offline draft' : 'Reply error' }}</span>{{ message.content }}
        </div>
        <div v-if="isSending" class="message assistant">Thinking…</div>
        <p v-if="errorMessage" class="form-error" role="alert">{{ errorMessage }}</p>
      </div>
      <div v-if="proposal" class="proposal ask-review">
        <span class="status-badge" :class="{ active: !isOfflineProposal }">{{ isOfflineProposal ? 'Offline draft plan' : 'Plan preview' }}</span>
        <fieldset class="proposal-fieldset" :disabled="Boolean(acceptedGoalId) || isAccepting">
          <ProposalEditor v-if="planDraft" v-model="planDraft" />
        </fieldset>
        <p v-if="planIssue && !acceptedGoalId" class="form-error" role="alert">{{ planIssue }}</p>
        <NuxtLink v-if="acceptedGoalId" :to="`/goals/${acceptedGoalId}`" class="button small" @click="emit('navigate')">
          <Check :size="15" /> View saved goal
        </NuxtLink>
        <div v-else class="ask-review-actions">
          <button type="button" class="button small" :disabled="!proposalId || isAccepting || Boolean(planIssue)" @click="accept">
            {{ isAccepting ? 'Saving…' : 'Accept and save plan' }}
          </button>
          <button type="button" class="button secondary small" :disabled="isAccepting" @click="dismiss">Dismiss</button>
        </div>
      </div>
      <div v-else-if="layout === 'page'" class="proposal ask-review ask-review-idle">
        <span class="status-badge">Proposal review</span>
        <p>Proposals appear here and stay inert until you accept them.</p>
      </div>
    </div>

    <form v-if="layout === 'panel'" class="ask-composer" @submit.prevent="send">
      <div class="ask-input">
        <textarea ref="composer" v-model="input" :maxlength="MAX_AI_MESSAGE_LENGTH" placeholder="Ask a question, or say what you want to achieve" aria-label="Message Kobi" aria-describedby="ask-message-counter" @keydown.enter.exact.prevent="send" />
        <button type="submit" class="button small" :disabled="!input.trim() || isSending" aria-label="Send message"><ArrowUp :size="16" /></button>
      </div>
      <div class="mt-1 flex justify-end">
        <span id="ask-message-counter" class="form-hint" aria-live="polite">{{ input.length.toLocaleString() }} / {{ MAX_AI_MESSAGE_LENGTH.toLocaleString() }} characters</span>
      </div>
    </form>
  </div>
</template>
