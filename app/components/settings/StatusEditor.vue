<script setup lang="ts">
import { ArrowDown, ArrowUp, Trash2 } from '@lucide/vue'
import type { Status, StatusCategory } from '#shared/types/domain'
import { STATUS_CATEGORIES } from '#shared/types/domain'
import { getUserFacingErrorMessage } from '#shared/utils/error-message'

// Rendered for workspace owners only: the endpoints enforce it, this just avoids offering
// controls that would answer 403.
const { statuses, createStatus, renameStatus, setDefaultStatus, reorderStatuses, deleteStatus } = useStatuses()

const names = reactive<Record<string, string>>({})
const newName = ref('')
const newCategory = ref<StatusCategory>('started')
const message = ref('')
const error = ref('')
const isBusy = ref(false)
const deletingId = ref<string | null>(null)
const replacementId = ref('')

watch(statuses, (list) => {
  for (const status of list) names[status.id] = status.name
}, { immediate: true })

const run = async (work: () => Promise<unknown>, success: string, failure: string) => {
  isBusy.value = true
  message.value = ''
  error.value = ''
  try {
    await work()
    message.value = success
  } catch (caught: unknown) {
    error.value = getUserFacingErrorMessage(caught, failure)
  } finally {
    isBusy.value = false
  }
}

const add = () => {
  if (!newName.value.trim()) return
  return run(async () => {
    await createStatus({ name: newName.value, category: newCategory.value })
    newName.value = ''
  }, 'Status added.', 'Could not add that status.')
}

const rename = (status: Status) => {
  const name = names[status.id]?.trim()
  if (!name || name === status.name) {
    names[status.id] = status.name
    return
  }
  return run(() => renameStatus(status.id, name), 'Status renamed.', 'Could not rename that status.')
}

const move = (status: Status, direction: -1 | 1) => {
  const ids = statuses.value.map(item => item.id)
  const from = ids.indexOf(status.id)
  const to = from + direction
  if (to < 0 || to >= ids.length) return
  ids.splice(to, 0, ...ids.splice(from, 1))
  return run(() => reorderStatuses(ids), 'Order saved.', 'Could not reorder the statuses.')
}

const makeDefault = (status: Status) =>
  run(() => setDefaultStatus(status.id), `${status.name} is now the default for new tasks.`, 'Could not change the default.')

const replacements = (status: Status) => statuses.value.filter(item => item.id !== status.id)

const startDelete = (status: Status) => {
  deletingId.value = status.id
  replacementId.value = replacements(status)[0]?.id ?? ''
}

const confirmDelete = (status: Status) => run(async () => {
  await deleteStatus(status.id, replacementId.value || undefined)
  deletingId.value = null
}, 'Status deleted; its tasks were moved.', 'Could not delete that status.')
</script>

<template>
  <section class="card card-pad section">
    <div class="section-heading">
      <div>
        <h2>Workflow statuses</h2>
        <p class="form-hint">Rename and reorder freely. A status keeps its category, which is what decides whether work counts as done.</p>
      </div>
      <span>{{ statuses.length }} statuses</span>
    </div>

    <div class="team-list">
      <div v-for="(status, index) in statuses" :key="status.id" class="label-admin-row">
        <div class="inline-actions">
          <input
            v-model="names[status.id]"
            class="input"
            maxlength="60"
            :aria-label="`Name for ${status.name}`"
            @blur="rename(status)"
            @keydown.enter.prevent="rename(status)"
          >
          <span class="status-badge">{{ status.category }}</span>
          <span v-if="status.isDefault" class="status-badge active">default</span>
        </div>
        <div class="inline-actions">
          <button type="button" class="button ghost small" :disabled="isBusy || index === 0" :aria-label="`Move ${status.name} up`" @click="move(status, -1)"><ArrowUp :size="14" aria-hidden="true" /></button>
          <button type="button" class="button ghost small" :disabled="isBusy || index === statuses.length - 1" :aria-label="`Move ${status.name} down`" @click="move(status, 1)"><ArrowDown :size="14" aria-hidden="true" /></button>
          <button
            v-if="!status.isDefault && status.category !== 'completed' && status.category !== 'canceled'"
            type="button"
            class="button ghost small"
            :disabled="isBusy"
            @click="makeDefault(status)"
          >
            Make default
          </button>
          <button type="button" class="button ghost small" :disabled="isBusy" :aria-label="`Delete ${status.name}`" @click="startDelete(status)"><Trash2 :size="14" aria-hidden="true" /></button>
        </div>
        <div v-if="deletingId === status.id" class="inline-actions">
          <label class="field">
            <span class="field-label">Move its tasks to</span>
            <select v-model="replacementId" class="input">
              <option v-for="option in replacements(status)" :key="option.id" :value="option.id">{{ option.name }}</option>
            </select>
          </label>
          <button type="button" class="button secondary small" :disabled="isBusy" @click="confirmDelete(status)">Delete {{ status.name }}</button>
          <button type="button" class="button ghost small" @click="deletingId = null">Cancel</button>
        </div>
      </div>
    </div>

    <form class="form-row" @submit.prevent="add">
      <label class="field"><span class="field-label">New status</span><input v-model="newName" class="input" maxlength="60" placeholder="In review"></label>
      <label class="field">
        <span class="field-label">Category</span>
        <select v-model="newCategory" class="input">
          <option v-for="category in STATUS_CATEGORIES" :key="category" :value="category">{{ category }}</option>
        </select>
        <span class="form-hint">Cannot be changed later.</span>
      </label>
      <button type="submit" class="button secondary" :disabled="isBusy">Add status</button>
    </form>

    <p v-if="message" class="form-hint">{{ message }}</p>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
  </section>
</template>
