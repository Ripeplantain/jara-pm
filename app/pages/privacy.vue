<script setup lang="ts">
definePageMeta({ layout: 'public' })
useSeoMeta({ title: 'Privacy · Kobi' })
</script>

<template><article class="auth-card"><h1>Privacy</h1><p>Kobi stores only the account and productivity data needed to provide the service. AI keys remain server-side, and your task content is sent to an AI provider only when you use Ask Kobi.</p><p>When configured, Kobi uses PostHog for product analytics and error reporting. Analytics records product actions such as creating tasks, completing tasks, and accepting plans. Session replay is disabled by default and is only enabled when the deployment explicitly turns it on.</p><NuxtLink to="/welcome" class="button secondary">Back to Kobi</NuxtLink></article></template>
