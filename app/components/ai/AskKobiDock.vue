<script setup lang="ts">
import { ChevronUp, Sparkles } from '@lucide/vue'
import type { TodayData } from '#shared/types/domain'

// A launcher only: every control hands a prompt to the existing Ask Kobi panel, where the
// proposal stays pending until the user accepts it.
const { open } = useAskKobi()
const isExpanded = ref(false)
const toggleEl = ref<HTMLButtonElement | null>(null)

// The context line reads data a page already fetched: Today's cached payload, or a short static
// line per route. The dock itself never fetches.
const route = useRoute()
const { data: today } = useNuxtData<TodayData>('today-dashboard')
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

const context = computed(() => {
  const path = route.path
  if (path === '/') {
    const overdue = today.value?.overdue.length ?? 0
    const priorities = today.value?.priorities.length ?? 0
    if (overdue) return `${plural(overdue, 'task is', 'tasks are')} overdue`
    if (priorities) return `${plural(priorities, 'priority', 'priorities')} today`
    return 'Your day is clear'
  }
  if (path === '/inbox') return 'Unsorted tasks can be triaged in one pass'
  if (path.startsWith('/goals')) return 'A goal with no tasks shows its progress as not measured'
  if (path.startsWith('/projects')) return 'A project with no milestones can be broken into stages'
  if (path === '/board') return 'A stalled column is a good place to replan'
  if (path === '/upcoming') return 'A crowded week is easier to rebalance early'
  return 'Kobi can plan, break down or reprioritise your work'
})

const suggestions = [
  { label: 'Plan a goal', message: 'Help me create a goal plan' },
  { label: 'Replan overdue tasks', message: 'Help me reschedule my overdue tasks' },
  { label: 'Break down a project', message: 'Help me break down a project' },
  { label: 'Triage my inbox', message: 'Help me triage my inbox' },
]

// Collapsing makes the chips inert, so focus is returned to the toggle first or it would fall to <body>.
const collapse = () => {
  if (!isExpanded.value) return
  isExpanded.value = false
  nextTick(() => toggleEl.value?.focus())
}

const launch = (message = '') => {
  isExpanded.value = false
  open(message)
}
</script>

<template>
  <div class="ask-dock" @keydown.esc="collapse">
    <div class="ask-dock-inner" :class="{ 'is-expanded': isExpanded }">
      <div class="ask-dock-bar">
        <button type="button" class="ask-dock-launch" @click="launch()">
          <Sparkles class="ask-dock-icon" :size="18" aria-hidden="true" />
          <span class="ask-dock-label">Ask Kobi<span class="ask-dock-hint"> to plan, break down or reprioritise…</span></span>
        </button>
        <button
          ref="toggleEl"
          type="button"
          class="ask-dock-toggle"
          :aria-expanded="isExpanded"
          aria-controls="ask-dock-suggestions"
          :aria-label="isExpanded ? 'Hide Ask Kobi suggestions' : 'Show Ask Kobi suggestions'"
          @click="isExpanded = !isExpanded"
        >
          <ChevronUp class="ask-dock-chevron" :size="18" aria-hidden="true" />
        </button>
      </div>
      <div id="ask-dock-suggestions" class="ask-dock-suggestions" :inert="!isExpanded || undefined">
        <div class="ask-dock-sheet">
          <p class="ask-dock-context"><span class="ask-dock-noticed">Kobi noticed</span> {{ context }}. Pick a starting point; nothing changes until you accept a proposal.</p>
          <ul class="ask-dock-chips">
            <li v-for="item in suggestions" :key="item.label">
              <button type="button" class="ask-dock-chip" @click="launch(item.message)">{{ item.label }}</button>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>
