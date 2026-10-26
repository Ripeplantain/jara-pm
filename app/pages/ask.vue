<script setup lang="ts">
definePageMeta({ middleware: ['authenticated'] })
useSeoMeta({ title: 'Ask Kobi · Kobi' })
</script>

<template>
  <main class="page ask-page">
    <header class="page-header">
      <div>
        <div class="eyebrow">Ask Kobi</div>
        <h1>What should move forward?</h1>
        <p>Kobi proposes. You review. Nothing is saved until you accept.</p>
      </div>
    </header>
    <AskKobiConversation layout="page" />
  </main>
</template>
