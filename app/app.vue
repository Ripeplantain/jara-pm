<script setup lang="ts">
const { initialize } = useTheme()
onMounted(initialize)
</script>

<template>
  <NuxtLoadingIndicator color="var(--color-primary)" />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
