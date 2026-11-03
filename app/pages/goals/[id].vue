<script setup lang="ts">
import { Archive, ArchiveRestore, CheckCircle2, Sparkles, Trash2 } from '@lucide/vue'
import type { Goal, Project } from '#shared/types/domain'

definePageMeta({ middleware: ['authenticated'] })
const route = useRoute()
const id = computed(() => String(route.params.id))
const { open } = useAskKobi()
const { data, status, error, refresh } = await useFetch<{ goal: Goal, projects: Project[] }>(() => `/api/goals/${id.value}`, {
  key: `goal-${id.value}`,
})

useSeoMeta({ title: computed(() => data.value ? `${data.value.goal.title} · Kobi` : 'Goal · Kobi') })

const { showUndo } = useToasts()
const { confirm: confirmAction } = useConfirmation()

// Permanent: every project under the goal goes too, with its milestones and tasks.
const remove = async () => {
  if (!data.value) return
  const accepted = await confirmAction({
    title: 'Delete this goal?',
    message: `“${data.value.goal.title}” will be permanently deleted with all of its projects (archived ones included) and their milestones and tasks. This cannot be undone.`,
    confirmLabel: 'Delete goal',
  })
  if (!accepted) return
  await $fetch(`/api/goals/${id.value}`, { method: 'DELETE' })
  await navigateTo('/goals')
  await Promise.all([refreshNuxtData('goals-list'), refreshNuxtData('projects-list')])
}

const patchStatus = (statusValue: Goal['status']) =>
  $fetch(`/api/goals/${id.value}`, { method: 'PATCH', body: { status: statusValue } })

// Every status change here is reversible, so each one is acknowledged with the way back rather
// than silently redrawing the page.
const setStatus = async (statusValue: Goal['status']) => {
  const previous = data.value?.goal.status ?? 'active'
  await patchStatus(statusValue)
  await refresh()
  await refreshNuxtData('goals-list')
  if (statusValue === previous) return
  showUndo({
    message: statusValue === 'archived'
      ? `Archived “${data.value?.goal.title ?? 'Goal'}”`
      : statusValue === 'completed' ? 'Goal marked complete' : 'Goal reopened',
    onCommit: () => {},
    onUndo: async () => {
      await patchStatus(previous)
      await refresh()
      await refreshNuxtData('goals-list')
    },
  })
}
</script>

<template>
  <main class="page">
    <LoadingState v-if="status === 'pending'" />
    <ErrorState v-else-if="error || !data" @retry="refresh" />
    <template v-else>
      <header class="page-header">
        <div>
          <div class="eyebrow">Goal</div>
          <h1>{{ data.goal.title }}</h1><span v-if="data.goal.status === 'archived'" class="status-badge archived">Archived</span>
          <p>{{ data.goal.description || 'A meaningful outcome you are working toward.' }}</p>
        </div>
        <div class="page-actions">
          <button type="button" class="button secondary" @click="open(`Help me make progress on ${data.goal.title}`)"><Sparkles :size="16" /> Ask Kobi</button>
          <button v-if="data.goal.status !== 'completed'" type="button" class="button" @click="setStatus('completed')"><CheckCircle2 :size="16" /> Mark complete</button>
          <button v-else type="button" class="button secondary" @click="setStatus('active')">Reopen</button>
          <button v-if="data.goal.status === 'archived'" type="button" class="button secondary" @click="setStatus('active')"><ArchiveRestore :size="16" /> Unarchive</button>
          <button v-else type="button" class="button ghost" @click="setStatus('archived')"><Archive :size="16" /> Archive</button>
          <button type="button" class="button ghost" @click="remove"><Trash2 :size="16" /> Delete</button>
        </div>
      </header>
      <section class="card card-pad goal-summary">
        <ProgressRing :value="data.goal.progress" :size="120" label="Goal progress" caption />
        <div class="form-row">
          <div><span class="field-label">Status</span><p class="detail-value">{{ data.goal.status }}</p></div>
          <div><span class="field-label">Target date</span><p class="detail-value">{{ data.goal.targetDate || 'No target date' }}</p></div>
        </div>
      </section>
      <section class="section">
        <div class="section-heading"><h2>Related projects</h2><NuxtLink to="/projects" class="button secondary small">Manage projects</NuxtLink></div>
        <div v-if="data.projects.length" class="entity-grid"><ProjectCard v-for="project in data.projects" :key="project.id" :project="project" /></div>
        <EmptyState v-else title="No projects connected" message="Create a project and connect it to this goal to begin measuring progress." />
      </section>
    </template>
  </main>
</template>
