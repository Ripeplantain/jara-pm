<script setup lang="ts">
import { Check, ChevronDown, LoaderCircle, Plus } from '@lucide/vue'

const props = withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })
const { data: workspaces, status, error, activeWorkspace, isChanging, actionError, activateWorkspace, createWorkspace } = useWorkspaces()
const { capture } = useProductAnalytics()
const isOpen = ref(false)
const isCreating = ref(false)
const name = ref('')
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const nameInput = ref<HTMLInputElement | null>(null)
const panelId = useId()
const initial = computed(() => (activeWorkspace.value?.name.trim()[0] ?? 'W').toUpperCase())

const close = (returnFocus = false) => {
  isOpen.value = false
  isCreating.value = false
  name.value = ''
  actionError.value = ''
  if (returnFocus) nextTick(() => trigger.value?.focus())
}

const toggle = () => {
  isOpen.value = !isOpen.value
  if (!isOpen.value) close()
}

const showCreate = () => {
  isCreating.value = true
  actionError.value = ''
  nextTick(() => nameInput.value?.focus())
}

const selectWorkspace = async (workspaceId: string) => {
  if (workspaceId === activeWorkspace.value?.id) {
    close(true)
    return
  }
  try {
    await activateWorkspace(workspaceId)
    capture('workspace_switched', { workspaceId })
    close()
  } catch {
    // The composable exposes a user-facing error in the open panel.
  }
}

const submitCreate = async () => {
  const workspaceName = name.value.trim()
  if (!workspaceName) return
  try {
    await createWorkspace(workspaceName)
    capture('workspace_created')
    close()
  } catch {
    // The composable exposes a user-facing error in the open panel.
  }
}

const onKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Escape' || !isOpen.value) return
  event.preventDefault()
  close(true)
}

onMounted(() => {
  const onPointerDown = (event: MouseEvent) => {
    if (!isOpen.value) return
    if (event.target instanceof Node && root.value?.contains(event.target)) return
    close()
  }
  document.addEventListener('mousedown', onPointerDown)
  onBeforeUnmount(() => document.removeEventListener('mousedown', onPointerDown))
})
</script>

<template>
  <div ref="root" class="workspace-switcher" :class="{ 'is-compact': props.compact }" @keydown="onKeydown">
    <button
      ref="trigger"
      type="button"
      class="workspace-trigger"
      :aria-expanded="isOpen"
      :aria-controls="panelId"
      :disabled="status === 'pending' && !activeWorkspace"
      @click="toggle"
    >
      <span class="workspace-trigger-copy">
        <span class="workspace-trigger-label">Workspace</span>
        <strong>{{ activeWorkspace?.name ?? (status === 'pending' ? 'Loading…' : 'Workspace') }}</strong>
      </span>
      <span class="workspace-initial" aria-hidden="true">{{ initial }}</span>
      <LoaderCircle v-if="isChanging" class="spin" :size="15" aria-hidden="true" />
      <ChevronDown v-else class="workspace-chevron" :size="15" aria-hidden="true" />
    </button>

    <div v-if="isOpen" :id="panelId" class="workspace-panel" role="region" aria-label="Choose a workspace">
      <div class="workspace-panel-heading">Your workspaces</div>
      <p v-if="error" class="workspace-error" role="alert">Could not load your workspaces.</p>
      <div class="workspace-options">
        <button
          v-for="workspace in workspaces"
          :key="workspace.id"
          type="button"
          class="workspace-option"
          :aria-current="workspace.isActive ? 'true' : undefined"
          :disabled="isChanging"
          @click="selectWorkspace(workspace.id)"
        >
          <span class="workspace-option-check"><Check v-if="workspace.isActive" :size="15" aria-hidden="true" /></span>
          <span class="workspace-option-copy"><strong>{{ workspace.name }}</strong><small>{{ workspace.role }}</small></span>
        </button>
      </div>

      <form v-if="isCreating" class="workspace-create" @submit.prevent="submitCreate">
        <label :for="`${panelId}-name`">Workspace name</label>
        <input :id="`${panelId}-name`" ref="nameInput" v-model="name" class="input" maxlength="120" autocomplete="off" required>
        <div class="inline-actions workspace-create-actions">
          <button type="button" class="button ghost small" :disabled="isChanging" @click="isCreating = false">Cancel</button>
          <button type="submit" class="button small" :disabled="isChanging || !name.trim()">{{ isChanging ? 'Creating…' : 'Create' }}</button>
        </div>
      </form>
      <button v-else type="button" class="workspace-create-button" :disabled="isChanging" @click="showCreate">
        <Plus :size="15" aria-hidden="true" /> Create workspace
      </button>
      <p v-if="actionError" class="workspace-error" role="alert">{{ actionError }}</p>
    </div>
  </div>
</template>
