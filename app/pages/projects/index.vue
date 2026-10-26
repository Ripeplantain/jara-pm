<script setup lang="ts">
import { Plus, X } from '@lucide/vue'
import type { Goal, Project } from '#shared/types/domain'

definePageMeta({ middleware: ['authenticated'] })
useSeoMeta({ title: 'Projects · Kobi' })
const isCreating = ref(false)
const isSaving = ref(false)
const form = reactive({ title: '', description: '', targetDate: '', goalId: null as string | null })
const { isEnabled, toggle } = useListPreferences()
const showArchived = computed(() => isEnabled('projects.showArchived'))
// The endpoint already accepts includeArchived; only the control was missing, which left an
// archived project with no route back into the UI.
const { data: projects, status, error, refresh } = await useFetch<Project[]>('/api/projects', {
  key: 'projects-list',
  query: computed(() => (showArchived.value ? { includeArchived: 'true' } : {})),
  default: () => [],
})
const archivedCount = computed(() => projects.value.filter(project => project.status === 'archived').length)
const menuItems = computed(() => [{
  label: 'Show Archived',
  checked: showArchived.value,
  onSelect: () => toggle('projects.showArchived'),
}])
const { data: goals } = await useFetch<Goal[]>('/api/goals', { key: 'project-form-goals', default: () => [], lazy: true })

const create = async () => {
  if (!form.title.trim()) return
  isSaving.value = true
  try {
    await $fetch('/api/projects', { method: 'POST', body: {
      title: form.title, description: form.description, goalId: form.goalId, targetDate: form.targetDate || null,
    } })
    Object.assign(form, { title: '', description: '', targetDate: '', goalId: null })
    isCreating.value = false
    await refresh()
  } finally { isSaving.value = false }
}
</script>

<template>
  <main class="page">
    <header class="page-header">
      <div><div class="eyebrow">Turn intent into action</div><h1>Projects</h1><p>Focused bodies of work, with or without a larger goal.</p></div>
      <div class="page-actions">
        <NuxtLink to="/board" class="button secondary">Board</NuxtLink>
        <span v-if="showArchived && archivedCount" class="status-badge archived">{{ archivedCount }} archived</span>
        <button type="button" class="button" @click="isCreating = true"><Plus :size="16" /> New project</button>
        <MenuButton :items="menuItems" label="Projects view options" />
      </div>
    </header>
    <section v-if="isCreating" class="card card-pad form-card">
      <div class="section-heading"><h2>Create a project</h2><button type="button" class="icon-button" aria-label="Close" @click="isCreating = false"><X :size="16" /></button></div>
      <form class="form-grid" @submit.prevent="create">
        <label class="field"><span>Project name</span><input v-model="form.title" class="input" required autofocus></label>
        <label class="field"><span>Description <small>(optional)</small></span><textarea v-model="form.description" class="textarea" /></label>
        <div class="form-row">
          <label class="field"><span>Goal <small>(optional)</small></span><select v-model="form.goalId" class="select"><option :value="null">No goal</option><option v-for="goal in goals" :key="goal.id" :value="goal.id">{{ goal.title }}</option></select></label>
          <label class="field"><span>Deadline <small>(optional)</small></span><input v-model="form.targetDate" type="date" class="input"></label>
        </div>
        <div><button type="submit" class="button" :disabled="isSaving">{{ isSaving ? 'Creating…' : 'Create project' }}</button></div>
      </form>
    </section>
    <LoadingState v-if="status === 'pending'" />
    <ErrorState v-else-if="error" @retry="refresh" />
    <div v-else-if="projects.length" class="entity-grid"><ProjectCard v-for="project in projects" :key="project.id" :project="project" /></div>
    <EmptyState v-else title="No projects yet" message="Projects keep related tasks together without adding unnecessary process."><button type="button" class="button small" @click="isCreating = true">Create your first project</button></EmptyState>
  </main>
</template>
