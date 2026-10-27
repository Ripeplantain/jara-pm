<script setup lang="ts">
const { request, accept, cancel } = useConfirmation()
const dialog = ref<HTMLElement | null>(null)
const cancelButton = ref<HTMLButtonElement | null>(null)
const titleId = useId()
const descriptionId = useId()
const isOpen = computed(() => request.value !== null)

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    cancel()
    return
  }
  if (event.key !== 'Tab' || !dialog.value) return

  const items = Array.from(dialog.value.querySelectorAll<HTMLElement>(FOCUSABLE))
  const first = items[0]
  const last = items[items.length - 1]
  if (!first || !last) return
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

let appRoot: HTMLElement | null = null

watch(isOpen, async (open) => {
  if (!import.meta.client) return
  appRoot ??= document.getElementById('__nuxt')
  if (appRoot) appRoot.inert = open
  if (!open) return
  await nextTick()
  cancelButton.value?.focus()
}, { immediate: true, flush: 'post' })

onBeforeUnmount(() => {
  if (appRoot) appRoot.inert = false
})
</script>

<template>
  <Teleport to="body">
    <div v-if="request" class="confirmation-layer" @pointerdown.self="cancel">
      <section
        ref="dialog"
        class="confirmation-dialog"
        role="alertdialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        :aria-describedby="descriptionId"
        @keydown="onKeydown"
      >
        <div class="confirmation-copy">
          <p class="eyebrow">Please confirm</p>
          <h2 :id="titleId" class="confirmation-title">{{ request.title }}</h2>
          <p :id="descriptionId" class="confirmation-message">{{ request.message }}</p>
        </div>
        <div class="confirmation-actions">
          <button ref="cancelButton" type="button" class="button secondary" @click="cancel">{{ request.cancelLabel }}</button>
          <button type="button" class="button danger" @click="accept">{{ request.confirmLabel }}</button>
        </div>
      </section>
    </div>
  </Teleport>
</template>
