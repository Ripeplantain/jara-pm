<template>
  <div class="task-list" aria-busy="true" aria-label="Loading">
    <div v-for="index in 4" :key="index" class="skeleton" />
  </div>
</template>
