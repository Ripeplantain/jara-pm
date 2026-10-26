<script setup lang="ts">
import { Check, Sparkles, X } from '@lucide/vue'
import type { Project, Task, TaskPriority, TriageReply } from '#shared/types/domain'
import { TRIAGE_BOUNDS } from '#shared/schemas/ai'
import { estimateOptions } from '#shared/utils/estimates'
import { getUserFacingErrorMessage } from '#shared/utils/error-message'

const props = defineProps<{ task: Task }>()
const emit = defineEmits<{ accepted: [] }>()
const { labels } = useLabels()
const { activeWorkspace } = useWorkspaces()
const { data: projects } = await useFetch<Project[]>('/api/projects', {
  key: 'triage-project-options', default: () => [], lazy: true, dedupe: 'defer',
})
const { refreshTaskViews } = useTaskViews()
const { captureException } = useProductAnalytics()
const isRequesting = ref(false)
const isResolving = ref(false)
const errorMessage = ref('')
const reply = ref<TriageReply | null>(null)
const draft = ref<TriageDraft | null>(null)
const issue = computed(() => (draft.value ? firstTriageIssue(draft.value) : ''))
const estimateChoices = computed(() => estimateOptions(activeWorkspace.value?.estimateScale ?? 'none'))
const priorities: Array<{ value: TaskPriority, label: string }> = [
  { value: 'none', label: 'No priority' }, { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' },
]

const request = async () => {
  if (isRequesting.value) return
  isRequesting.value = true
  errorMessage.value = ''
  try {
    const result = await $fetch<TriageReply>('/api/ai/triage', { method: 'POST', body: { taskId: props.task.id } })
    reply.value = result
    draft.value = result.proposal ? toTriageDraft(result.proposal) : null
  } catch (error: unknown) {
    captureException(error, { flow: 'ask_kobi_triage' })
    errorMessage.value = getUserFacingErrorMessage(error, 'Kobi could not triage this task.')
  } finally { isRequesting.value = false }
}

const toggleLabel = (labelId: string) => {
  if (!draft.value) return
  if (draft.value.labelIds.includes(labelId)) {
    draft.value.labelIds = draft.value.labelIds.filter(id => id !== labelId)
    return
  }
  const label = labels.value.find(item => item.id === labelId)
  if (!label || draft.value.labelIds.length >= TRIAGE_BOUNDS.labelIds) return
  const siblings = new Set(labels.value.filter(item => label.groupId && item.groupId === label.groupId).map(item => item.id))
  draft.value.labelIds = [...draft.value.labelIds.filter(id => !siblings.has(id)), labelId]
}

const resolve = async (accept: boolean) => {
  if (!reply.value?.proposalId || isResolving.value) return
  isResolving.value = true
  errorMessage.value = ''
  try {
    if (accept && draft.value) {
      await $fetch(`/api/ai/proposals/${reply.value.proposalId}/accept`, {
        method: 'POST', body: { proposal: toTriageProposal(draft.value) },
      })
      await refreshTaskViews()
      emit('accepted')
    } else {
      await $fetch(`/api/ai/proposals/${reply.value.proposalId}/reject`, { method: 'POST' })
    }
    reply.value = null
    draft.value = null
  } catch (error: unknown) {
    captureException(error, { flow: accept ? 'ask_kobi_triage_accept' : 'ask_kobi_triage_reject' })
    errorMessage.value = getUserFacingErrorMessage(error, accept ? 'The triage changes could not be saved.' : 'The suggestion could not be dismissed.')
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
  <div class="ai-action triage-action">
    <button v-if="!reply" type="button" class="button ghost small" :disabled="isRequesting" @click="request">
      <Sparkles :size="14" aria-hidden="true" /> {{ isRequesting ? 'Triaging…' : 'Triage with Kobi' }}
    </button>
    <div v-else class="ai-proposal-card">
      <div class="ai-proposal-heading">
        <span class="status-badge" :class="{ active: reply.source === 'model' }">{{ reply.source === 'model' ? 'Triage preview' : reply.source === 'offline' ? 'Offline' : 'Reply error' }}</span>
        <button type="button" class="icon-button" aria-label="Reject and close triage suggestion" :disabled="isResolving" @click="dismiss"><X :size="15" /></button>
      </div>
      <p>{{ reply.message }}</p>
      <template v-if="draft">
        <div class="ai-form-grid">
          <label class="field"><span>Priority</span><select v-model="draft.priority" class="select"><option v-for="option in priorities" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
          <label class="field"><span>Project</span><select v-model="draft.projectId" class="select"><option :value="null">Inbox</option><option v-for="project in projects" :key="project.id" :value="project.id">{{ project.title }}</option></select></label>
          <label v-if="estimateChoices.length" class="field"><span>Estimate</span><select v-model="draft.estimate" class="select"><option :value="null">No estimate</option><option v-for="option in estimateChoices" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
        </div>
        <div v-if="labels.length" class="field"><span>Labels</span><div class="proposal-label-options"><button v-for="label in labels" :key="label.id" type="button" class="button ghost small" :class="{ active: draft.labelIds.includes(label.id) }" :aria-pressed="draft.labelIds.includes(label.id)" @click="toggleLabel(label.id)"><LabelChip :label="label" /></button></div></div>
        <p v-if="draft.reason" class="form-hint">{{ draft.reason }}</p>
        <p v-if="issue" class="form-error" role="alert">{{ issue }}</p>
        <div class="inline-actions">
          <button type="button" class="button small" :disabled="isResolving || Boolean(issue)" @click="resolve(true)"><Check :size="14" /> {{ isResolving ? 'Saving…' : 'Accept changes' }}</button>
          <button type="button" class="button ghost small" :disabled="isResolving" @click="resolve(false)">Reject</button>
        </div>
      </template>
      <button v-else type="button" class="button ghost small" :disabled="isRequesting" @click="request">Try again</button>
    </div>
    <p v-if="errorMessage" class="form-error" role="alert">{{ errorMessage }}</p>
  </div>
</template>
