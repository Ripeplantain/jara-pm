<script setup lang="ts">
import { Tag } from '@lucide/vue'
import type { Label, Task } from '#shared/types/domain'

const props = defineProps<{ task: Task }>()
const emit = defineEmits<{ updated: [task: Task] }>()

const { groups, labels, ungrouped, inGroup, attach, detach, errorMessageFor } = useLabels()
const { captureException } = useProductAnalytics()

const isOpen = ref(false)
const isSaving = ref(false)
const errorMessage = ref('')
const trigger = ref<HTMLButtonElement | null>(null)
const panel = ref<HTMLElement | null>(null)

const attachedIds = computed(() => new Set(props.task.labels.map(label => label.id)))
const isAttached = (label: Label) => attachedIds.value.has(label.id)

const close = ({ restoreFocus = true } = {}) => {
  if (!isOpen.value) return
  isOpen.value = false
  if (restoreFocus) trigger.value?.focus()
}

const open = async () => {
  isOpen.value = true
  errorMessage.value = ''
  await nextTick()
  panel.value?.querySelector<HTMLElement>('button')?.focus()
}

const toggleOpen = () => (isOpen.value ? close() : open())

// A side effect, not a modal: clicking anywhere else or pressing Escape puts the panel away
// without blocking the list behind it.
const onDocumentPointerDown = (event: PointerEvent) => {
  const target = event.target as Node | null
  if (!target) return
  if (panel.value?.contains(target) || trigger.value?.contains(target)) return
  close({ restoreFocus: false })
}

onMounted(() => document.addEventListener('pointerdown', onDocumentPointerDown))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointerDown))

/**
 * Toggling a label is optimistic in feel but reconciled in fact: the server returns the task
 * as it now stands, which is the only thing that knows which sibling a grouped label replaced.
 */
const toggleLabel = async (label: Label) => {
  if (isSaving.value) return
  isSaving.value = true
  errorMessage.value = ''
  try {
    const task = isAttached(label)
      ? await detach(props.task.id, label.id)
      : await attach(props.task.id, label.id)
    emit('updated', task)
  } catch (error: unknown) {
    captureException(error, { flow: 'task_label_toggle' })
    errorMessage.value = errorMessageFor(error, 'Kobi could not change that label.')
  } finally {
    isSaving.value = false
  }
}

const hasAnyLabel = computed(() => labels.value.length > 0)
</script>

<template>
  <div class="label-picker">
    <button
      ref="trigger"
      type="button"
      class="button ghost small"
      :aria-label="`Labels for ${task.title}`"
      :aria-expanded="isOpen"
      aria-haspopup="true"
      @click="toggleOpen"
      @keydown.esc="close()"
    >
      <Tag :size="15" aria-hidden="true" />
    </button>

    <div
      v-if="isOpen"
      ref="panel"
      class="label-panel"
      role="group"
      :aria-label="`Labels for ${task.title}`"
      @keydown.esc.stop="close()"
    >
      <p v-if="!hasAnyLabel" class="form-hint">
        No labels yet. Create them in Settings.
      </p>

      <div v-for="group in groups" :key="group.id" class="label-group">
        <!-- Labels inside a group are mutually exclusive, so the control reads as a radio set. -->
        <p class="label-group-name">{{ group.name }} <span class="form-hint">· pick one</span></p>
        <button
          v-for="label in inGroup(group.id)"
          :key="label.id"
          type="button"
          class="label-option"
          role="radio"
          :aria-checked="isAttached(label)"
          :class="{ selected: isAttached(label) }"
          :disabled="isSaving"
          @click="toggleLabel(label)"
        >
          <LabelChip :label="label" :muted="!isAttached(label)" />
        </button>
      </div>

      <div v-if="ungrouped.length" class="label-group">
        <p class="label-group-name">Labels</p>
        <button
          v-for="label in ungrouped"
          :key="label.id"
          type="button"
          class="label-option"
          role="checkbox"
          :aria-checked="isAttached(label)"
          :class="{ selected: isAttached(label) }"
          :disabled="isSaving"
          @click="toggleLabel(label)"
        >
          <LabelChip :label="label" :muted="!isAttached(label)" />
        </button>
      </div>

      <p v-if="errorMessage" class="form-error" role="alert">{{ errorMessage }}</p>
    </div>
  </div>
</template>
