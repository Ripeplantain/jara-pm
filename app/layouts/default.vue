<script setup lang="ts">
const { isOpen, close } = useAskKobi()
const { isOpen: isPaletteOpen } = useCommandPalette()
const { isOpen: isTaskPanelOpen } = useTaskPanel()
const { isCompact } = useCompactViewport()
// The full-screen /ask page is the conversation, so the dock and side panel step aside there.
const route = useRoute()
const isAskPage = computed(() => route.path === '/ask')

// Cmd/Ctrl+K for the whole app. Bound here rather than in the palette so the shortcut works
// before the palette has ever been opened, and only on authenticated pages -- the sign-in
// screens render under the `public` layout.
useCommandShortcut()

/**
 * Below the panel's breakpoint the panel covers the whole screen, so everything behind it is
 * made `inert`: without this the list stays tabbable and reachable by a screen reader while
 * being completely hidden. Above the breakpoint the panel sits beside the list and the list is
 * meant to stay live, which is the entire point of a panel rather than a modal.
 *
 * `|| undefined` matters: that is the value Vue drops entirely, both when rendering on the
 * server and when patching on the client. A literal `inert="false"` is still inert as far as the
 * browser is concerned.
 */
const isPanelBlocking = computed<true | undefined>(
  () => (isTaskPanelOpen.value && isCompact.value) || undefined,
)
</script>

<template>
  <!--
    `has-task-panel` narrows the main column instead of covering it, which is what keeps the list
    beside an open panel readable and interactive rather than merely visible behind a modal.
  -->
  <div class="app-frame" :class="{ 'has-task-panel': isTaskPanelOpen }">
    <AppSidebar :inert="isPanelBlocking" />
    <div class="app-main" :inert="isPanelBlocking">
      <AppTopbar />
      <slot />
    </div>
    <TaskPanel v-if="isTaskPanelOpen" />
    <MobileNav :inert="isPanelBlocking" />
    <!-- Hidden while any overlay is open so it never sits over the panels, palette or tab bar. -->
    <AskKobiDock v-if="!isAskPage && !isOpen && !isPaletteOpen && !isTaskPanelOpen" />
    <AskKobiPanel v-if="isOpen && !isAskPage" @close="close" />
    <CommandPalette v-if="isPaletteOpen" />
    <ToastHost />
  </div>
</template>
