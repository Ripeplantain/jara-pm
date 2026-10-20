<script setup lang="ts">
import { Archive, ArchiveRestore, Plus, Sparkles } from '@lucide/vue'
import type { Project, Task } from '#shared/types/domain'

definePageMeta({ middleware: ['authenticated'] })
const route = useRoute()
const id = computed(() => String(route.params.id))
const { user } = useUserSession()
const { open } = useAskKobi()
const isAddingMilestone = ref(false)
const milestoneTitle = ref('')
const { data, status, error, refresh } = await useFetch<{ project: Project, tasks: Task[] }>(() => `/api/projects/${id.value}`, {
  key: `project-${id.value}`,
})
const assigneeFilter = ref<'everyone' | 'me' | 'unassigned'>('everyone')
const { isEnabled, toggle } = useListPreferences()
const { showUndo } = useToasts()
// This endpoint already returns completed tasks, so the toggle filters here. Hidden by default,
// so every task list in the app behaves the same way.
const showCompleted = computed(() => isEnabled('project.showCompleted'))
const assignedTasks = computed(() => {
  if (!data.value || assigneeFilter.value === 'everyone') return data.value?.tasks ?? []
  if (assigneeFilter.value === 'me') return data.value.tasks.filter(task => task.assigneeId === user.value?.id)
  return data.value.tasks.filter(task => !task.assigneeId)
})
const filteredTasks = computed(() =>
  showCompleted.value ? assignedTasks.value : assignedTasks.value.filter(task => task.status !== 'done'))
const completedCount = computed(() => assignedTasks.value.filter(task => task.status === 'done').length)
const menuItems = computed(() => [{
  label: 'Show Completed',
  checked: showCompleted.value,
  onSelect: () => toggle('project.showCompleted'),
}])
useSeoMeta({ title: computed(() => data.value ? `${data.value.project.title} · Kobi` : 'Project · Kobi') })

const addMilestone = async () => {
  if (!milestoneTitle.value.trim()) return
  await $fetch(`/api/projects/${id.value}/milestones`, { method: 'POST', body: { title: milestoneTitle.value } })
  milestoneTitle.value = ''
  isAddingMilestone.value = false
  await refresh()
}

const setStatus = (statusValue: Project['status']) =>
  $fetch(`/api/projects/${id.value}`, { method: 'PATCH', body: { status: statusValue } })

// Archiving navigates away, so the toast is the only acknowledgement the person gets - and it
// carries the way back, rather than leaving the project unreachable.
const archive = async () => {
  const title = data.value?.project.title ?? 'Project'
  await setStatus('archived')
  await navigateTo('/projects')
  showUndo({
    message: `Archived “${title}”`,
    onCommit: () => {},
    onUndo: async () => {
      await setStatus('active')
      await refreshNuxtData('projects-list')
    },
  })
}

const unarchive = async () => {
  await setStatus('active')
  await refresh()
  await refreshNuxtData('projects-list')
}
</script>

<template>
  <main class="page">
    <LoadingState v-if="status === 'pending'" />
    <ErrorState v-else-if="error || !data" @retry="refresh" />
    <template v-else>
      <header class="page-header">
        <div><div class="eyebrow">{{ data.project.goalTitle || 'Independent project' }}</div><h1>{{ data.project.title }}</h1><span v-if="data.project.status === 'archived'" class="status-badge archived">Archived</span><p>{{ data.project.description || 'Keep the work simple and visible.' }}</p></div>
        <div class="page-actions">
          <button type="button" class="button secondary" @click="open(`Help me break down ${data.project.title}`)"><Sparkles :size="16" /> Ask Kobi</button>
          <button v-if="data.project.status === 'archived'" type="button" class="button secondary" @click="unarchive"><ArchiveRestore :size="16" /> Unarchive</button>
          <button v-else type="button" class="button ghost" @click="archive"><Archive :size="16" /> Archive</button>
        </div>
      </header>
      <section class="card card-pad"><ProgressBar :value="data.project.progress" label="Project progress" /></section>
      <section class="section">
        <div class="section-heading"><h2>Milestones</h2><button type="button" class="button secondary small" @click="isAddingMilestone = !isAddingMilestone"><Plus :size="15" /> Add milestone</button></div>
        <form v-if="isAddingMilestone" class="capture-main card milestone-form" @submit.prevent="addMilestone">
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
        <div class="section-heading"><h2>Tasks</h2><div class="inline-actions"><select v-model="assigneeFilter" class="task-assignee" aria-label="Filter tasks by assignee"><option value="everyone">Everyone</option><option value="me">Assigned to me</option><option value="unassigned">Unassigned</option></select><span>{{ filteredTasks.length }}</span><span v-if="!showCompleted && completedCount" class="status-badge completed">{{ completedCount }} completed</span><MenuButton :items="menuItems" label="Task view options" /></div></div>
        <QuickCapture :default-project-id="data.project.id" @created="refresh" @ask="open" />
        <TaskList :tasks="filteredTasks" :enable-assignees="true" empty-title="No tasks yet" empty-message="Add the first concrete next step above." @changed="refresh" />
      </section>
    </template>
  </main>
</template>
