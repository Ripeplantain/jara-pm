<template>
  <div class="public-shell">
    <aside class="public-brand">
      <div class="public-art" aria-hidden="true">
        <div class="public-art-grid" />
        <div class="public-art-ring" />
        <div class="public-art-card">
          <div class="public-art-card-header"><span class="public-art-card-icon">K</span><span class="public-art-card-menu">•••</span></div>
          <div class="public-art-card-title" />
          <div class="public-art-card-lines"><span /><span /><span /></div>
          <div class="public-art-card-footer"><span /><span /><span /></div>
        </div>
      </div>
      <AppLogo />
      <blockquote>Less planning.<br>More doing.</blockquote>
      <p>Kobi turns meaningful goals into work you can do today.</p>
    </aside>
    <main class="public-content">
      <slot />
    </main>
  </div>
</template>
