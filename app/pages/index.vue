<script setup lang="ts">
import { Sparkles } from '@lucide/vue'
import type { TodayData } from '#shared/types/domain'

definePageMeta({ middleware: ['authenticated'] })
useSeoMeta({ title: 'Today · Kobi' })

const { open } = useAskKobi()
const { formatLongDate } = useDateFormat()
const { isEnabled, toggle } = useListPreferences()
const emptyToday = (): TodayData => ({ date: '', greeting: '', priorities: [], overdue: [], upcoming: [], completedToday: [], suggestion: null })
const { data, status, error, refresh } = await useFetch<TodayData>('/api/today', {
  key: 'today-dashboard',
  default: emptyToday,
})
const showCompleted = computed(() => isEnabled('today.showCompleted'))
const menuItems = computed(() => [{
  label: 'Show Completed',
  checked: showCompleted.value,
  onSelect: () => toggle('today.showCompleted'),
}])
</script>

<template>
  <main class="page narrow">
    <header class="page-header">
      <div>
        <div class="eyebrow">{{ data.date ? formatLongDate(data.date) : 'Today' }}</div>
        <h1>{{ data.greeting || 'Here’s what matters today.' }}</h1>
        <p>Here’s what matters today.</p>
      </div>
      <div class="page-actions"><MenuButton :items="menuItems" label="Today view options" /></div>
    </header>
    <QuickCapture @created="refresh" @ask="open" />
    <LoadingState v-if="status === 'pending'" />
    <ErrorState v-else-if="error" @retry="refresh" />
    <template v-else>
      <div v-if="data.suggestion" class="callout">
        <Sparkles aria-hidden="true" />
        <p><strong>Kobi suggests:</strong> {{ data.suggestion }}</p>
      </div>
      <section class="section" aria-labelledby="priorities-heading">
        <div class="section-heading"><h2 id="priorities-heading">Today’s priorities</h2><span>{{ data.priorities.length }}</span></div>
        <TaskList :tasks="data.priorities" empty-title="A clear day" empty-message="Add a task above or choose something from your inbox." />
      </section>
      <section v-if="data.overdue.length" class="section" aria-labelledby="overdue-heading">
        <div class="section-heading"><h2 id="overdue-heading">Overdue</h2><span>{{ data.overdue.length }}</span><AiRescheduleAction :tasks="data.overdue" @accepted="refresh" /></div>
        <TaskList :tasks="data.overdue" show-reschedule />
      </section>
      <section v-if="showCompleted && data.completedToday.length" class="section" aria-labelledby="completed-heading">
        <div class="section-heading"><h2 id="completed-heading">Completed today</h2><span>{{ data.completedToday.length }}</span></div>
        <TaskList :tasks="data.completedToday" />
      </section>
      <section class="section" aria-labelledby="up-next-heading">
        <div class="section-heading"><h2 id="up-next-heading">Up next</h2><NuxtLink to="/upcoming">See all</NuxtLink></div>
        <TaskList :tasks="data.upcoming" empty-title="Nothing due soon" empty-message="Your upcoming schedule is open." />
      </section>
    </template>
  </main>
</template>
