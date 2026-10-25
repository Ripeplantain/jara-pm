<script setup lang="ts">
import { Search } from '@lucide/vue'
import type { CommandAction } from '~/composables/useCommandPalette'

const { query, results, close } = useCommandPalette()
const { focused } = useFocusedTask()
const { capture } = useProductAnalytics()
useGlobalCommands()

const input = ref<HTMLInputElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const listbox = ref<HTMLElement | null>(null)
const highlighted = ref(0)
// One action at a time. Without this, holding Enter or double-tapping it on a creating action
// fires the request twice and makes two tasks.
const isRunning = ref(false)

const optionId = (index: number) => `command-option-${index}`

/**
 * With a query the list is a single ranked run, because the best match has to be first and
 * grouping would scatter it. With nothing typed there is no ranking to respect, so the sections
 * give the list a shape worth reading.
 */
const sections = computed<Array<{ name: string, actions: Array<{ action: CommandAction, index: number }> }>>(() => {
  const entries = results.value.map((action, index) => ({ action, index }))
  if (query.value.trim()) {
    return entries.length ? [{ name: 'Results', actions: entries }] : []
  }
  const grouped = new Map<string, Array<{ action: CommandAction, index: number }>>()
  for (const entry of entries) {
    const existing = grouped.get(entry.action.group)
    if (existing) existing.push(entry)
    else grouped.set(entry.action.group, [entry])
  }
  return [...grouped].map(([name, actions]) => ({ name, actions }))
})

// Any change to the result set puts the highlight back on the best match, which is what Enter
// should run after a keystroke.
watch(results, () => { highlighted.value = 0 })

const move = (delta: number) => {
  const total = results.value.length
  if (total === 0) return
  // Wrapping keeps a long list reachable from either end.
  highlighted.value = (highlighted.value + delta + total) % total
  nextTick(() => {
    listbox.value?.querySelector<HTMLElement>(`#${optionId(highlighted.value)}`)
      ?.scrollIntoView({ block: 'nearest' })
  })
}

const run = async (action: CommandAction | undefined) => {
  if (!action || isRunning.value) return
  isRunning.value = true
  try {
    await action.run()
  } finally {
    isRunning.value = false
  }
}

const onKeydown = (event: KeyboardEvent) => {
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      return move(1)
    case 'ArrowUp':
      event.preventDefault()
      return move(-1)
    case 'Home':
      event.preventDefault()
      highlighted.value = 0
      return
    case 'End':
      event.preventDefault()
      highlighted.value = Math.max(results.value.length - 1, 0)
      return
    case 'Enter':
      event.preventDefault()
      return void run(results.value[highlighted.value])
    case 'Escape':
      event.preventDefault()
      return close()
    case 'Tab':
      // The palette is modal, so Tab must not walk into the page behind it. The input is the
      // only focusable control, so holding focus there is the whole trap.
      event.preventDefault()
      return input.value?.focus()
    default:
      return
  }
}

// Returning focus to whatever was focused before is what makes the palette feel like an overlay
// rather than a navigation: dismissing it puts the person back exactly where they were.
let previouslyFocused: HTMLElement | null = null

onMounted(async () => {
  capture('command_palette_opened', { has_focused_task: focused.value !== null })
  previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
  await nextTick()
  input.value?.focus()
})

onBeforeUnmount(() => {
  previouslyFocused?.focus()
})
</script>

<template>
  <div class="command-overlay" @pointerdown.self="close()">
    <div
      ref="panel"
      class="command-palette"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      @keydown="onKeydown"
    >
      <div class="command-input-row">
        <Search :size="16" aria-hidden="true" />
        <input
          ref="input"
          v-model="query"
          type="text"
          class="command-input"
          placeholder="Search commands, projects, or a task key…"
          aria-label="Search commands"
          role="combobox"
          aria-autocomplete="list"
          :aria-expanded="results.length > 0"
          aria-controls="command-listbox"
          :aria-activedescendant="results.length ? optionId(highlighted) : undefined"
          autocomplete="off"
          spellcheck="false"
        >
      </div>

      <!--
        A listbox may only own `option` and `group` children, so each section is a real group and
        its heading is presentational -- otherwise the option count and the
        `aria-activedescendant` target are mis-reported.
      -->
      <div id="command-listbox" ref="listbox" class="command-results" role="listbox" aria-label="Commands">
        <div
          v-for="section in sections"
          :key="section.name"
          class="command-section"
          role="group"
          :aria-label="section.name"
        >
          <p class="command-section-name" role="presentation">{{ section.name }}</p>
          <div
            v-for="entry in section.actions"
            :id="optionId(entry.index)"
            :key="entry.action.id"
            class="command-option"
            :class="{ highlighted: entry.index === highlighted }"
            role="option"
            :aria-selected="entry.index === highlighted"
            @pointermove="highlighted = entry.index"
            @mousedown.prevent
            @click="run(entry.action)"
          >
            <component :is="entry.action.icon" v-if="entry.action.icon" :size="15" aria-hidden="true" />
            <span class="command-option-label">{{ entry.action.label }}</span>
            <span v-if="query.trim()" class="command-option-group">{{ entry.action.group }}</span>
          </div>
        </div>
        <p v-if="!results.length" class="command-empty">No commands match “{{ query }}”.</p>
      </div>

      <div class="command-footer">
        <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
        <span><kbd>↵</kbd> run</span>
        <span><kbd>esc</kbd> close</span>
      </div>
    </div>
  </div>
</template>
