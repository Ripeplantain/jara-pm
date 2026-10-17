<script setup lang="ts">
import { Plus, Sparkles, X } from '@lucide/vue'
import type { Goal } from '#shared/types/domain'

definePageMeta({ middleware: ['authenticated'] })
useSeoMeta({ title: 'Goals · Kobi' })

const { open } = useAskKobi()
const isCreating = ref(false)
const isSaving = ref(false)
const form = reactive({ title: '', description: '', targetDate: '' })
const { data: goals, status, error, refresh } = await useFetch<Goal[]>('/api/goals', {
  key: 'goals-list', default: () => [],
})

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
  <main class="page">
    <header class="page-header">
      <div><div class="eyebrow">Your direction</div><h1>Goals</h1><p>Keep the outcomes that matter visible and connected to real work.</p></div>
      <div class="page-actions">
        <button type="button" class="button secondary" @click="open('Help me create a goal plan')"><Sparkles :size="16" /> Plan with Kobi</button>
        <button type="button" class="button" @click="isCreating = true"><Plus :size="16" /> New goal</button>
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
    <div v-else-if="goals.length" class="grid">
      <GoalCard v-for="goal in goals" :key="goal.id" :goal="goal" />
    </div>
    <EmptyState v-else title="No goals yet" message="Create one manually or ask Kobi to turn an idea into a practical plan.">
      <button type="button" class="button small" @click="isCreating = true">Create your first goal</button>
    </EmptyState>
  </main>
</template>
