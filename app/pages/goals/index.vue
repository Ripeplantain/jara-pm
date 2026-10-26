<script setup lang="ts">
import { Plus, Sparkles, X } from '@lucide/vue'
import type { Goal } from '#shared/types/domain'

definePageMeta({ middleware: ['authenticated'] })
useSeoMeta({ title: 'Goals · Kobi' })

const { open } = useAskKobi()
const isCreating = ref(false)
const isSaving = ref(false)
const form = reactive({ title: '', description: '', targetDate: '' })
const { isEnabled, toggle } = useListPreferences()
const showArchived = computed(() => isEnabled('goals.showArchived'))
const { data: goals, status, error, refresh } = await useFetch<Goal[]>('/api/goals', {
  key: 'goals-list',
  query: computed(() => (showArchived.value ? { includeArchived: 'true' } : {})),
  default: () => [],
})
const measuredCount = computed(() => goals.value.filter(goal => goal.status === 'active' && goal.progress !== null).length)
const activeCount = computed(() => goals.value.filter(goal => goal.status === 'active').length)
const selectedId = ref<string | null>(null)
const tiles = ref<Record<string, { $el: HTMLElement } | null>>({})
const closeDrawer = async (restoreFocus = true) => {
  const id = selectedId.value
  selectedId.value = null
  await nextTick()
  if (restoreFocus && id) tiles.value[id]?.$el.focus()
}
const archivedCount = computed(() => goals.value.filter(goal => goal.status === 'archived').length)
const menuItems = computed(() => [{
  label: 'Show Archived',
  checked: showArchived.value,
  onSelect: () => toggle('goals.showArchived'),
}])

const create = async () => {
  if (!form.title.trim()) return
  isSaving.value = true
  try {
    await $fetch('/api/goals', {
      method: 'POST',
      body: { title: form.title, description: form.description, targetDate: form.targetDate || null },
    })
    Object.assign(form, { title: '', description: '', targetDate: '' })
    isCreating.value = false
    await refresh()
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <main class="page wide">
    <header class="page-header">
      <div>
        <div class="eyebrow">Goals</div>
        <h1>What you are working toward</h1>
        <p v-if="activeCount">{{ activeCount }} active {{ activeCount === 1 ? 'goal' : 'goals' }}. {{ measuredCount }} measured by their tasks; a goal with no tasks shows as not measured rather than zero.</p>
        <p v-else>Keep the outcomes that matter visible and connected to real work.</p>
      </div>
      <div class="page-actions">
        <button type="button" class="button secondary" @click="open('Help me create a goal plan')"><Sparkles :size="16" /> Plan with Kobi</button>
        <button type="button" class="button" @click="isCreating = true"><Plus :size="16" /> New goal</button>
        <span v-if="showArchived && archivedCount" class="status-badge archived">{{ archivedCount }} archived</span>
        <MenuButton :items="menuItems" label="Goals view options" />
      </div>
    </header>

    <section v-if="isCreating" class="card card-pad form-card">
      <div class="section-heading"><h2>Create a goal</h2><button type="button" class="icon-button" aria-label="Close" @click="isCreating = false"><X :size="16" /></button></div>
      <form class="form-grid" @submit.prevent="create">
        <label class="field"><span>What do you want to achieve?</span><input v-model="form.title" class="input" required autofocus></label>
        <label class="field"><span>Why does it matter?</span><textarea v-model="form.description" class="textarea" /></label>
        <label class="field"><span>Target date <small>(optional)</small></span><input v-model="form.targetDate" type="date" class="input"></label>
        <div><button type="submit" class="button" :disabled="isSaving">{{ isSaving ? 'Creating…' : 'Create goal' }}</button></div>
      </form>
    </section>

    <LoadingState v-if="status === 'pending'" />
    <ErrorState v-else-if="error" @retry="refresh" />
    <template v-else-if="goals.length">
      <ul class="goal-tiles" aria-label="Goals">
        <li v-for="goal in goals" :key="goal.id">
          <GoalCard :ref="(el) => { tiles[goal.id] = el as { $el: HTMLElement } | null }" :goal="goal" :selected="selectedId === goal.id" @select="selectedId = goal.id" />
        </li>
      </ul>
      <p class="goal-hint"><Sparkles class="goal-hint-icon" :size="18" aria-hidden="true" /> Select a goal to see its projects, milestones and the next step Kobi recommends.</p>
    </template>
    <EmptyState v-else title="No goals yet" message="Create one manually or ask Kobi to turn an idea into a practical plan.">
      <button type="button" class="button small" @click="isCreating = true">Create your first goal</button>
    </EmptyState>
    <GoalDrawer v-if="selectedId" :key="selectedId" :goal-id="selectedId" @close="closeDrawer" />
  </main>
</template>
