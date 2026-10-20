<script setup lang="ts">
import { MoreHorizontal } from '@lucide/vue'

/**
 * An anchored popover menu, not a modal: it never dims the page or traps focus, matching how a
 * platform menu behaves. A `checked` item becomes a menuitemcheckbox, which is the right role for
 * a view toggle like "Show Completed" - it reports its on/off state to assistive technology
 * instead of reading as a plain command.
 */
type MenuItem = {
  label: string
  checked?: boolean
  destructive?: boolean
  onSelect: () => void
}

const props = withDefaults(defineProps<{ items: MenuItem[], label?: string }>(), {
  label: 'More options',
})

const isOpen = ref(false)
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const itemElements = ref<HTMLButtonElement[]>([])

const setItemRef = (element: unknown, index: number) => {
  if (element instanceof HTMLButtonElement) itemElements.value[index] = element
}

const focusItem = (index: number) => {
  const count = props.items.length
  if (!count) return
  const wrapped = (index + count) % count
  nextTick(() => itemElements.value[wrapped]?.focus())
}

const close = (returnFocus = true) => {
  if (!isOpen.value) return
  isOpen.value = false
  if (returnFocus) nextTick(() => trigger.value?.focus())
}

const open = (focusIndex: number | null = null) => {
  isOpen.value = true
  if (focusIndex !== null) focusItem(focusIndex)
}

const toggle = () => (isOpen.value ? close() : open())

const select = (item: MenuItem) => {
  item.onSelect()
  close()
}

const onTriggerKeydown = (event: KeyboardEvent) => {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    open(0)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    open(-1)
  }
}

const onMenuKeydown = (event: KeyboardEvent, index: number) => {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    focusItem(index + 1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    focusItem(index - 1)
  } else if (event.key === 'Home') {
    event.preventDefault()
    focusItem(0)
  } else if (event.key === 'End') {
    event.preventDefault()
    focusItem(-1)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    close()
  } else if (event.key === 'Tab') {
    // Tabbing out of a menu dismisses it, leaving focus wherever the page takes it next.
    close(false)
  }
}

onMounted(() => {
  const onPointerDown = (event: MouseEvent) => {
    if (!isOpen.value) return
    if (event.target instanceof Node && root.value?.contains(event.target)) return
    close(false)
  }
  document.addEventListener('mousedown', onPointerDown)
  onBeforeUnmount(() => document.removeEventListener('mousedown', onPointerDown))
})
</script>

<template>
  <div ref="root" class="menu">
    <button
      ref="trigger"
      type="button"
      class="icon-button"
      :aria-label="props.label"
      aria-haspopup="menu"
      :aria-expanded="isOpen"
      @click="toggle"
      @keydown="onTriggerKeydown"
    >
      <MoreHorizontal :size="18" aria-hidden="true" />
    </button>
    <div v-if="isOpen" class="menu-panel" role="menu" :aria-label="props.label">
      <button
        v-for="(item, index) in props.items"
        :key="item.label"
        :ref="element => setItemRef(element, index)"
        type="button"
        class="menu-item"
        :class="{ 'is-destructive': item.destructive, 'is-checked': item.checked }"
        :role="item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'"
        :aria-checked="item.checked === undefined ? undefined : item.checked"
        @click="select(item)"
        @keydown="event => onMenuKeydown(event, index)"
      >
        <span class="menu-item-check" aria-hidden="true">{{ item.checked ? '✓' : '' }}</span>
        <span>{{ item.label }}</span>
      </button>
    </div>
  </div>
</template>
