<script setup lang="ts">
const { isOpen, close } = useAskKobi()
</script>

<template>
  <div class="app-frame">
    <AppSidebar />
    <div class="app-main">
      <AppTopbar />
      <slot />
    </div>
    <MobileNav />
    <AskKobiPanel v-if="isOpen" @close="close" />
  </div>
</template>
