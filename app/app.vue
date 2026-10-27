<script setup lang="ts">
const { initialize } = useTheme()
const { initialize: initializeListPreferences } = useListPreferences()
const { loggedIn, user } = useUserSession()
const { identify, reset } = useProductAnalytics()

watch([loggedIn, user], ([isLoggedIn, currentUser]) => {
  if (isLoggedIn && currentUser) identify(currentUser.id)
  else if (!isLoggedIn) reset()
}, { immediate: true })

onMounted(() => {
  initialize()
  initializeListPreferences()
})
</script>

<template>
  <NuxtLoadingIndicator color="var(--color-primary)" />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
  <ConfirmationHost />
</template>
