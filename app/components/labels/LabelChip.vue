<script setup lang="ts">
import type { Label } from '#shared/types/domain'

const props = withDefaults(defineProps<{ label: Label, muted?: boolean }>(), { muted: false })

// An archived label still appears on the tasks that carry it, so it is marked rather than
// hidden -- the row should not silently lose a label when it leaves the picker.
const title = computed(() => {
  const parts = [props.label.groupName ? `${props.label.groupName}: ${props.label.name}` : props.label.name]
  if (props.label.description) parts.push(props.label.description)
  if (props.label.archivedAt) parts.push('Archived')
  return parts.join(' — ')
})
</script>

<template>
  <span class="label-chip" :class="[`color-${label.color}`, { muted, archived: label.archivedAt }]" :title="title">
    <span class="label-dot" aria-hidden="true" />
    <span class="label-chip-text">{{ label.name }}</span>
  </span>
</template>
