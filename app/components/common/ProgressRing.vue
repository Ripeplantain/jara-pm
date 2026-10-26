<script setup lang="ts">
// A slim progress ring. `null` means "not measured" and is drawn as a dashed empty ring -- it is
// never shown as 0%.
const props = withDefaults(defineProps<{
  /** 0-100, or null when progress is unmeasured. */
  value: number | null
  size?: number
  label?: string
  /** Show the "Not measured" text beside an unmeasured ring. */
  caption?: boolean
}>(), { size: 64, label: 'Progress', caption: false })

const stroke = computed(() => (props.size >= 96 ? 4 : 3))
const radius = computed(() => (props.size - stroke.value) / 2)
const circumference = computed(() => 2 * Math.PI * radius.value)

// Sweep the ring in on first paint, unless the person prefers reduced motion.
const ready = ref(false)
onMounted(() => {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (reduced) ready.value = true
  else requestAnimationFrame(() => { ready.value = true })
})

const offset = computed(() => {
  if (props.value === null) return circumference.value
  return ready.value ? circumference.value * (1 - props.value / 100) : circumference.value
})
const accessibleLabel = computed(() =>
  `${props.label}: ${props.value === null ? 'Not measured' : `${props.value}%`}`)
</script>

<template>
  <span class="progress-ring-wrap">
    <span class="progress-ring" :style="{ width: `${size}px`, height: `${size}px` }" role="img" :aria-label="accessibleLabel">
      <svg :width="size" :height="size" :viewBox="`0 0 ${size} ${size}`" aria-hidden="true">
        <circle
          class="progress-ring-track"
          :class="{ 'is-unmeasured': value === null }"
          :cx="size / 2" :cy="size / 2" :r="radius"
          :stroke-width="stroke"
          fill="none"
        />
        <circle
          v-if="value !== null"
          class="progress-ring-bar"
          :cx="size / 2" :cy="size / 2" :r="radius"
          :stroke-width="stroke"
          fill="none"
          stroke-linecap="round"
          :stroke-dasharray="circumference"
          :stroke-dashoffset="offset"
          :transform="`rotate(-90 ${size / 2} ${size / 2})`"
        />
      </svg>
      <span class="progress-ring-value" :style="{ fontSize: `${size * 0.3}px` }" aria-hidden="true">
        <template v-if="value === null">&mdash;</template>
        <template v-else>{{ value }}<small>%</small></template>
      </span>
    </span>
    <span v-if="value === null && caption" class="progress-ring-caption">Not measured</span>
  </span>
</template>
