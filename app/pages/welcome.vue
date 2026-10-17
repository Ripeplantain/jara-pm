<script setup lang="ts">
definePageMeta({ layout: false })
useSeoMeta({ title: 'Kobi — Less planning. More doing.', description: 'Turn meaningful goals into work you can do today.' })
</script>

<template>
  <main class="welcome">
    <nav class="welcome-nav">
      <AppLogo />
      <div style="display:flex;gap:8px">
        <NuxtLink to="/signin" class="button secondary">Sign in</NuxtLink>
        <NuxtLink to="/signup" class="button">Start for free</NuxtLink>
      </div>
    </nav>
    <section class="welcome-hero">
      <div>
        <div class="eyebrow">Your calm productivity companion</div>
        <h1>Less planning.<br>More doing.</h1>
        <p>Kobi turns goals into practical projects and helps you choose the work that matters today.</p>
        <div class="welcome-actions">
          <NuxtLink to="/signup" class="button">Build your first plan</NuxtLink>
          <NuxtLink to="/signin" class="button secondary">I already have an account</NuxtLink>
        </div>
      </div>
    </section>
  </main>
</template>
