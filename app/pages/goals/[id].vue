<script setup lang="ts">
import { Archive, CheckCircle2, Sparkles } from '@lucide/vue'
import type { Goal, Project } from '#shared/types/domain'

definePageMeta({ middleware: ['authenticated'] })
const route = useRoute()
const id = computed(() => String(route.params.id))
const { open } = useAskKobi()
const { data, status, error, refresh } = await useFetch<{ goal: Goal, projects: Project[] }>(() => `/api/goals/${id.value}`, {
  key: `goal-${id.value}`,
})

useSeoMeta({ title: computed(() => data.value ? `${data.value.goal.title} · Kobi` : 'Goal · Kobi') })

const setStatus = async (statusValue: Goal['status']) => {
  await $fetch(`/api/goals/${id.value}`, { method: 'PATCH', body: { status: statusValue } })
  await refresh()
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
          <h1>{{ data.goal.title }}</h1>
          <p>{{ data.goal.description || 'A meaningful outcome you are working toward.' }}</p>
        </div>
        <div class="page-actions">
          <button type="button" class="button secondary" @click="open(`Help me make progress on ${data.goal.title}`)"><Sparkles :size="16" /> Ask Kobi</button>
          <button v-if="data.goal.status !== 'completed'" type="button" class="button" @click="setStatus('completed')"><CheckCircle2 :size="16" /> Mark complete</button>
          <button v-else type="button" class="button secondary" @click="setStatus('active')">Reopen</button>
          <button type="button" class="button ghost" @click="setStatus('archived')"><Archive :size="16" /> Archive</button>
        </div>
      </header>
      <section class="card card-pad">
        <div class="form-row">
          <div><span class="field-label">Status</span><p class="detail-value">{{ data.goal.status }}</p></div>
          <div><span class="field-label">Target date</span><p class="detail-value">{{ data.goal.targetDate || 'No target date' }}</p></div>
        </div>
        <ProgressBar :value="data.goal.progress" label="Goal progress" />
      </section>
      <section class="section">
        <div class="section-heading"><h2>Related projects</h2><NuxtLink to="/projects" class="button secondary small">Manage projects</NuxtLink></div>
        <div v-if="data.projects.length" class="grid"><ProjectCard v-for="project in data.projects" :key="project.id" :project="project" /></div>
        <EmptyState v-else title="No projects connected" message="Create a project and connect it to this goal to begin measuring progress." />
      </section>
    </template>
  </main>
</template>
