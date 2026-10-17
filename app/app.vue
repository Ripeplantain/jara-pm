<script setup lang="ts">
const { initialize } = useTheme()
const { loggedIn, user } = useUserSession()
const { identify, reset } = useProductAnalytics()

watch([loggedIn, user], ([isLoggedIn, currentUser]) => {
  if (isLoggedIn && currentUser) identify(currentUser.id)
  else if (!isLoggedIn) reset()
}, { immediate: true })

onMounted(initialize)
</script>

<template>
  <NuxtLoadingIndicator color="var(--color-primary)" />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
