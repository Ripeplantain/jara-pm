<script setup lang="ts">
import { ArrowRight, Sparkles } from '@lucide/vue'
import type { Goal, TodayData } from '#shared/types/domain'

definePageMeta({ middleware: ['authenticated'] })
useSeoMeta({ title: 'Today · Kobi' })

const { open } = useAskKobi()
const { formatLongDate, formatDate } = useDateFormat()
const { isEnabled, toggle } = useListPreferences()
const emptyToday = (): TodayData => ({ date: '', greeting: '', priorities: [], overdue: [], upcoming: [], completedToday: [], suggestion: null })
const { data, status, error, refresh } = await useFetch<TodayData>('/api/today', {
  key: 'today-dashboard',
  default: emptyToday,
})
// The goals page keys its list on a query that can include archived goals, so Today keeps its own
// entry rather than sharing one that two pages would fetch differently.
const { data: goals } = await useFetch<Goal[]>('/api/goals', {
  key: 'today-goals',
  default: () => [],
})
const activeGoals = computed(() => goals.value.filter(goal => goal.status === 'active'))
const nowTask = computed(() => data.value.priorities[0] ?? null)
const queue = computed(() => data.value.priorities.slice(1))
const doneToday = computed(() => data.value.completedToday.length)
const totalToday = computed(() => doneToday.value + data.value.priorities.length)
const todayPercent = computed(() => (totalToday.value ? Math.round((doneToday.value / totalToday.value) * 100) : null))
const showCompleted = computed(() => isEnabled('today.showCompleted'))
const menuItems = computed(() => [{
  label: 'Show Completed',
  checked: showCompleted.value,
  onSelect: () => toggle('today.showCompleted'),
}])
</script>

<template>
  <main class="page wide today">
    <header class="page-header">
      <div>
        <div class="eyebrow">{{ data.date ? formatLongDate(data.date) : 'Today' }}</div>
        <h1>{{ data.greeting || 'Here’s what matters today.' }}</h1>
        <p>Here’s what matters today.</p>
      </div>
      <div class="page-actions">
        <div v-if="todayPercent !== null" class="day-count" role="group" aria-label="Today’s progress">
          <span class="day-count-num">{{ doneToday }}<small>/{{ totalToday }}</small></span>
          <span class="day-count-meta">
            <span>done today</span>
            <span class="progress day-count-bar" aria-hidden="true"><span :style="{ width: `${todayPercent}%` }" /></span>
          </span>
        </div>
        <MenuButton :items="menuItems" label="Today view options" />
      </div>
    </header>
    <QuickCapture @created="refresh" @ask="open" />
    <LoadingState v-if="status === 'pending'" />
    <ErrorState v-else-if="error" @retry="refresh" />
    <template v-else>
      <section class="today-hero" aria-labelledby="priorities-heading">
        <h2 id="priorities-heading" class="sr-only">Today’s priorities</h2>
        <NowCard v-if="nowTask" :task="nowTask" />
        <EmptyState v-else title="A clear day" message="Add a task above or choose something from your inbox." />
      </section>

      <div class="today-lower">
        <div class="today-main">
          <section v-if="queue.length" aria-labelledby="queue-heading">
            <div class="section-heading"><h2 id="queue-heading">Today’s queue</h2><span>{{ queue.length }} left</span></div>
            <TaskList :tasks="queue" />
          </section>
          <section v-if="data.overdue.length" class="sub-section" aria-labelledby="overdue-heading">
            <div class="sub-heading"><h3 id="overdue-heading">Overdue <span>{{ data.overdue.length }}</span></h3><AiRescheduleAction :tasks="data.overdue" @accepted="refresh" /></div>
            <TaskList :tasks="data.overdue" show-reschedule />
          </section>
          <section v-if="showCompleted && data.completedToday.length" class="sub-section" aria-labelledby="completed-heading">
            <div class="sub-heading"><h3 id="completed-heading">Completed today <span>{{ data.completedToday.length }}</span></h3></div>
            <TaskList :tasks="data.completedToday" />
          </section>
          <section class="sub-section" aria-labelledby="up-next-heading">
            <div class="sub-heading"><h3 id="up-next-heading">Up next</h3><NuxtLink to="/upcoming" class="text-link">See all <ArrowRight :size="14" aria-hidden="true" /></NuxtLink></div>
            <TaskList :tasks="data.upcoming" empty-title="Nothing due soon" empty-message="Your upcoming schedule is open." />
          </section>
        </div>

        <aside class="today-side">
          <section v-if="activeGoals.length" aria-labelledby="today-goals-heading">
            <div class="section-heading"><h2 id="today-goals-heading">Goals</h2><NuxtLink to="/goals" class="text-link">All goals <ArrowRight :size="14" aria-hidden="true" /></NuxtLink></div>
            <ul class="goal-rings">
              <li v-for="goal in activeGoals" :key="goal.id">
                <NuxtLink :to="`/goals/${goal.id}`" class="goal-ring-row">
                  <ProgressRing :value="goal.progress" :size="56" :label="`${goal.title} progress`" />
                  <span class="goal-ring-text">
                    <span class="goal-ring-name">{{ goal.title }}</span>
                    <span class="goal-ring-sub">{{ goal.progress === null ? 'Not measured' : `${goal.progress}% done` }} · {{ goal.targetDate ? formatDate(goal.targetDate) : 'No target date' }}</span>
                  </span>
                </NuxtLink>
              </li>
            </ul>
          </section>
          <section v-if="data.suggestion" class="kobi-card" aria-labelledby="kobi-suggestion-heading">
            <p id="kobi-suggestion-heading" class="eyebrow"><Sparkles :size="14" aria-hidden="true" /> Kobi suggests</p>
            <p class="kobi-card-text">{{ data.suggestion }}</p>
            <button type="button" class="button secondary" @click="open()">Ask Kobi</button>
          </section>
        </aside>
      </div>
    </template>
  </main>
</template>
