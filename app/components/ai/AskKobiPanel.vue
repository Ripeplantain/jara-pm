<script setup lang="ts">
import { ArrowUp, Check, Sparkles, X } from '@lucide/vue'
import type { AiReply, GoalPlanProposal } from '#shared/types/domain'

const emit = defineEmits<{ close: [] }>()
const mode = ref<'chat' | 'goal_plan'>('chat')
const input = ref('')
const isSending = ref(false)
const isAccepting = ref(false)
const errorMessage = ref('')
const messages = ref<Array<{ role: 'user' | 'assistant', content: string }>>([])
const proposal = ref<GoalPlanProposal | null>(null)
const proposalId = ref<string | null>(null)
const acceptedGoalId = ref<string | null>(null)
const inputElement = useTemplateRef<HTMLTextAreaElement>('composer')
const { draft } = useAskKobi()

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
  messages.value.push({ role: 'user', content: message })
  input.value = ''
  isSending.value = true
  errorMessage.value = ''
  try {
    const reply = await $fetch<AiReply>('/api/ai/ask', { method: 'POST', body: { message, mode: mode.value } })
    messages.value.push({ role: 'assistant', content: reply.message })
    proposal.value = reply.proposal
    proposalId.value = reply.proposalId
  } catch (error: unknown) {
    errorMessage.value = error instanceof Error ? error.message : 'Kobi could not respond.'
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
    errorMessage.value = error instanceof Error ? error.message : 'The plan could not be saved.'
  } finally {
    isAccepting.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="ask-overlay" @click="emit('close')" />
    <aside class="ask-panel" role="dialog" aria-modal="true" aria-labelledby="ask-title">
      <header class="ask-header">
        <h2 id="ask-title">Ask Kobi</h2>
        <button type="button" class="icon-button" aria-label="Close Ask Kobi" @click="emit('close')"><X :size="18" /></button>
      </header>
      <div class="ask-body" aria-live="polite">
        <div v-if="messages.length === 0" class="ask-intro">
          <span class="brand-mark"><Sparkles :size="16" /></span>
          <strong>What would make progress easier?</strong>
          <p>Ask what to focus on, or let Kobi draft a goal plan for you to review.</p>
        </div>
        <div v-for="(message, index) in messages" :key="index" class="message" :class="message.role">{{ message.content }}</div>
        <div v-if="isSending" class="message assistant">Thinking…</div>
        <div v-if="proposal" class="proposal">
          <span class="status-badge active">Plan preview</span>
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
        <p v-if="errorMessage" class="form-error">{{ errorMessage }}</p>
      </div>
      <form class="ask-composer" @submit.prevent="send">
        <div class="ask-mode" aria-label="Ask Kobi mode">
          <button type="button" :class="{ active: mode === 'chat' }" @click="mode = 'chat'">Ask a question</button>
          <button type="button" :class="{ active: mode === 'goal_plan' }" @click="mode = 'goal_plan'">Plan a goal</button>
        </div>
        <div class="ask-input">
          <textarea ref="composer" v-model="input" :placeholder="mode === 'goal_plan' ? 'I want to…' : 'What should I focus on?'" aria-label="Message Kobi" @keydown.enter.exact.prevent="send" />
          <button type="submit" class="button small" :disabled="!input.trim() || isSending" aria-label="Send message"><ArrowUp :size="16" /></button>
        </div>
      </form>
    </aside>
  </Teleport>
</template>
