<script setup lang="ts">
import { splitTaskKeyMentions } from '#shared/utils/task-key'

const props = defineProps<{ text: string }>()

// Segments rather than interpolated HTML: the text is user-supplied, so it is never rendered
// with v-html. Concatenating the segments reproduces the original exactly.
const segments = computed(() => splitTaskKeyMentions(props.text))
</script>

<template>
  <span class="task-text"><template v-for="(segment, index) in segments" :key="index"><NuxtLink
    v-if="segment.key"
    :to="`/${segment.key}`"
    class="task-key-link"
  >{{ segment.text }}</NuxtLink><template v-else>{{ segment.text }}</template></template></span>
</template>
