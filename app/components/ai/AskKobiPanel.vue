<script setup lang="ts">
import { ArrowUp, Check, Maximize2, Minimize2, Sparkles, X } from '@lucide/vue'
import { MAX_AI_MESSAGE_LENGTH } from '#shared/schemas/ai'
import type { AiReply, AiReplySource, GoalPlanProposal } from '#shared/types/domain'
import { getUserFacingErrorMessage } from '#shared/utils/error-message'

const emit = defineEmits<{ close: [] }>()
const mode = ref<'chat' | 'goal_plan'>('chat')
const input = ref('')
const isSending = ref(false)
const isAccepting = ref(false)
const errorMessage = ref('')
const messages = ref<Array<{ role: 'user' | 'assistant', content: string, source?: AiReplySource }>>([])
const proposal = ref<GoalPlanProposal | null>(null)
const proposalId = ref<string | null>(null)
const acceptedGoalId = ref<string | null>(null)
const isOfflineProposal = ref(false)
const isMaximized = ref(false)
const inputElement = useTemplateRef<HTMLTextAreaElement>('composer')
const { draft } = useAskKobi()
const { captureException } = useProductAnalytics()

onMounted(() => {
  input.value = draft.value
  draft.value = ''
  inputElement.value?.focus()
  document.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
}

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
    const reply = await $fetch<AiReply>('/api/ai/ask', { method: 'POST', body: { message, mode: mode.value } })
    messages.value.push({ role: 'assistant', content: reply.message, source: reply.source })
    proposal.value = reply.proposal
    proposalId.value = reply.proposalId
    isOfflineProposal.value = reply.source === 'offline'
  } catch (error: unknown) {
    captureException(error, { flow: 'ask_kobi_message', mode: mode.value })
    errorMessage.value = getUserFacingErrorMessage(error, 'Kobi could not respond.', {
      validation: `Your message is too long. Please keep it to ${MAX_AI_MESSAGE_LENGTH.toLocaleString()} characters or fewer.`,
    })
  } finally {
    isSending.value = false
  }
}

const accept = async () => {
  if (!proposalId.value || isAccepting.value) return
  isAccepting.value = true
  try {
    const result = await $fetch<{ goalId: string }>(`/api/ai/proposals/${proposalId.value}/accept`, { method: 'POST' })
    acceptedGoalId.value = result.goalId
    proposalId.value = null
    messages.value.push({ role: 'assistant', content: 'Your plan is saved. I created the goal, projects, milestones, and tasks.' })
  } catch (error: unknown) {
    captureException(error, { flow: 'ask_kobi_plan_accept' })
    errorMessage.value = getUserFacingErrorMessage(error, 'The plan could not be saved.')
  } finally {
    isAccepting.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="ask-overlay" @click="emit('close')" />
    <aside class="ask-panel" :class="{ 'is-maximized': isMaximized }" role="dialog" aria-modal="true" aria-labelledby="ask-title">
      <header class="ask-header">
        <h2 id="ask-title">Ask Kobi</h2>
        <div class="ask-header-actions">
          <button
            type="button"
            class="icon-button"
            :aria-label="isMaximized ? 'Minimize Ask Kobi' : 'Maximize Ask Kobi'"
            :aria-pressed="isMaximized"
            :title="isMaximized ? 'Minimize' : 'Maximize'"
            @click="isMaximized = !isMaximized"
          >
            <Minimize2 v-if="isMaximized" :size="18" />
            <Maximize2 v-else :size="18" />
          </button>
          <button type="button" class="icon-button" aria-label="Close Ask Kobi" @click="emit('close')"><X :size="18" /></button>
        </div>
      </header>
      <div class="ask-body" aria-live="polite">
        <div v-if="messages.length === 0" class="ask-intro">
          <span class="brand-mark"><Sparkles :size="16" /></span>
          <strong>What would make progress easier?</strong>
          <p>Ask what to focus on, or let Kobi draft a goal plan for you to review.</p>
        </div>
        <div v-for="(message, index) in messages" :key="index" class="message" :class="message.role">
          <span v-if="message.source === 'offline' || message.source === 'invalid'" class="status-badge message-badge">{{ message.source === 'offline' ? 'Offline draft' : 'Reply error' }}</span>{{ message.content }}
        </div>
        <div v-if="isSending" class="message assistant">Thinking…</div>
        <div v-if="proposal" class="proposal">
          <span class="status-badge" :class="{ active: !isOfflineProposal }">{{ isOfflineProposal ? 'Offline draft plan' : 'Plan preview' }}</span>
          <h3>{{ proposal.goal.title }}</h3>
          <p class="proposal-description">{{ proposal.goal.description }}</p>
          <ul class="proposal-projects">
            <li v-for="project in proposal.projects" :key="project.title" class="proposal-project">
              <div class="proposal-project-header">
                <strong>{{ project.title }}</strong>
                <span class="proposal-task-count">{{ project.milestones.reduce((sum, milestone) => sum + milestone.tasks.length, 0) }} tasks</span>
              </div>
              <div class="proposal-milestones">
                <div v-for="milestone in project.milestones" :key="milestone.title" class="proposal-milestone">
                  <p class="proposal-milestone-title">{{ milestone.title }}</p>
                  <ul class="proposal-tasks">
                    <li v-for="task in milestone.tasks" :key="task.title" class="proposal-task">
                      <span class="proposal-task-marker" />
                      <span class="proposal-task-title">{{ task.title }}</span>
                      <span v-if="task.priority !== 'none'" class="proposal-task-priority" :class="task.priority">{{ task.priority }}</span>
                    </li>
                  </ul>
                </div>
              </div>
            </li>
          </ul>
          <NuxtLink v-if="acceptedGoalId" :to="`/goals/${acceptedGoalId}`" class="button small" @click="emit('close')">
            <Check :size="15" /> View saved goal
          </NuxtLink>
          <button v-else type="button" class="button small" :disabled="!proposalId || isAccepting" @click="accept">
            {{ isAccepting ? 'Saving…' : 'Accept and save plan' }}
          </button>
        </div>
        <p v-if="errorMessage" class="form-error" role="alert">{{ errorMessage }}</p>
      </div>
      <form class="ask-composer" @submit.prevent="send">
        <div class="ask-mode" aria-label="Ask Kobi mode">
          <button type="button" :class="{ active: mode === 'chat' }" @click="mode = 'chat'">Ask a question</button>
          <button type="button" :class="{ active: mode === 'goal_plan' }" @click="mode = 'goal_plan'">Plan a goal</button>
        </div>
        <div class="ask-input">
          <textarea ref="composer" v-model="input" :maxlength="MAX_AI_MESSAGE_LENGTH" :placeholder="mode === 'goal_plan' ? 'I want to…' : 'What should I focus on?'" aria-label="Message Kobi" aria-describedby="ask-message-counter" @keydown.enter.exact.prevent="send" />
          <button type="submit" class="button small" :disabled="!input.trim() || isSending" aria-label="Send message"><ArrowUp :size="16" /></button>
        </div>
        <div class="mt-1 flex justify-end">
          <span id="ask-message-counter" class="form-hint" aria-live="polite">{{ input.length.toLocaleString() }} / {{ MAX_AI_MESSAGE_LENGTH.toLocaleString() }} characters</span>
        </div>
      </form>
    </aside>
  </Teleport>
</template>
