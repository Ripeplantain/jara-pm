<script setup lang="ts">
import { Archive, Plus, Sparkles } from '@lucide/vue'
import type { Project, Task } from '#shared/types/domain'

definePageMeta({ middleware: ['authenticated'] })
const route = useRoute()
const id = computed(() => String(route.params.id))
const { open } = useAskKobi()
const isAddingMilestone = ref(false)
const milestoneTitle = ref('')
const { data, status, error, refresh } = await useFetch<{ project: Project, tasks: Task[] }>(() => `/api/projects/${id.value}`, {
  key: `project-${id.value}`,
})
useSeoMeta({ title: computed(() => data.value ? `${data.value.project.title} · Kobi` : 'Project · Kobi') })

const addMilestone = async () => {
  if (!milestoneTitle.value.trim()) return
  await $fetch(`/api/projects/${id.value}/milestones`, { method: 'POST', body: { title: milestoneTitle.value } })
  milestoneTitle.value = ''
  isAddingMilestone.value = false
  await refresh()
}

const archive = async () => {
  await $fetch(`/api/projects/${id.value}`, { method: 'PATCH', body: { status: 'archived' } })
  await navigateTo('/projects')
}
</script>

<template>
  <main class="page">
    <LoadingState v-if="status === 'pending'" />
    <ErrorState v-else-if="error || !data" @retry="refresh" />
    <template v-else>
      <header class="page-header">
        <div><div class="eyebrow">{{ data.project.goalTitle || 'Independent project' }}</div><h1>{{ data.project.title }}</h1><p>{{ data.project.description || 'Keep the work simple and visible.' }}</p></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="button secondary" @click="open(`Help me break down ${data.project.title}`)"><Sparkles :size="16" /> Ask Kobi</button>
          <button type="button" class="button ghost" @click="archive"><Archive :size="16" /> Archive</button>
        </div>
      </header>
      <section class="card card-pad"><ProgressBar :value="data.project.progress" label="Project progress" /></section>
      <section class="section">
        <div class="section-heading"><h2>Milestones</h2><button type="button" class="button secondary small" @click="isAddingMilestone = !isAddingMilestone"><Plus :size="15" /> Add milestone</button></div>
        <form v-if="isAddingMilestone" class="capture-main card" style="margin-bottom:12px" @submit.prevent="addMilestone">
          <input v-model="milestoneTitle" placeholder="Milestone title" aria-label="Milestone title" autofocus>
          <button type="submit" class="button small">Add</button>
        </form>
        <div v-if="data.project.milestones.length" class="card">
          <div v-for="milestone in data.project.milestones" :key="milestone.id" class="milestone">
            <div class="milestone-header"><div><h3>{{ milestone.title }}</h3><p>{{ milestone.taskCount }} tasks · {{ milestone.targetDate || 'No target date' }}</p></div><span class="status-badge" :class="milestone.status">{{ milestone.status }}</span></div>
            <ProgressBar :value="milestone.progress" />
          </div>
        </div>
        <EmptyState v-else title="Milestones are optional" message="Add them when the project has meaningful stages. Tasks can live directly in the project." />
      </section>
      <section class="section">
        <div class="section-heading"><h2>Tasks</h2><span>{{ data.tasks.length }}</span></div>
        <QuickCapture :default-project-id="data.project.id" @created="refresh" @ask="open" />
        <TaskList :tasks="data.tasks" empty-title="No tasks yet" empty-message="Add the first concrete next step above." @changed="refresh" />
      </section>
    </template>
  </main>
</template>
