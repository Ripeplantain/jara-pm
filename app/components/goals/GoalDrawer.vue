<script setup lang="ts">
import { ArrowRight, Sparkles, X } from '@lucide/vue'
import type { Goal, Project } from '#shared/types/domain'

// A side drawer (bottom sheet on narrow screens) with the same data as the goal page, read from
// the same keyed request. The rest of the app is made inert while it is open and the parent
// returns focus to the tile that opened it.
const props = defineProps<{ goalId: string }>()
const emit = defineEmits<{ close: [restoreFocus: boolean] }>()

const { open } = useAskKobi()
const { formatDate } = useDateFormat()
const { data, status, error, refresh } = useFetch<{ goal: Goal, projects: Project[] }>(() => `/api/goals/${props.goalId}`, {
  key: `goal-${props.goalId}`,
})

const dialog = ref<HTMLElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)
const titleId = useId()
let appRoot: HTMLElement | null = null

const FOCUSABLE = 'a[href], button:not(:disabled), input, select, textarea, [tabindex]:not([tabindex="-1"])'

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    event.stopPropagation()
    emit('close', true)
    return
  }
  if (event.key !== 'Tab' || !dialog.value) return
  const items = Array.from(dialog.value.querySelectorAll<HTMLElement>(FOCUSABLE))
  const first = items[0]
  const last = items[items.length - 1]
  if (!first || !last) return
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

onMounted(() => {
  appRoot = document.getElementById('__nuxt')
  if (appRoot) appRoot.inert = true
  document.addEventListener('keydown', onKeydown)
  closeButton.value?.focus()
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  if (appRoot) appRoot.inert = false
})

const askKobi = () => {
  if (!data.value) return
  const goal = data.value.goal
  emit('close', false)
  open(`Help me make progress on ${goal.title}`)
}
</script>

<template>
  <Teleport to="body">
    <div class="drawer-layer">
      <div class="drawer-scrim" aria-hidden="true" @click="emit('close', true)" />
      <aside ref="dialog" class="drawer" role="dialog" aria-modal="true" :aria-labelledby="titleId">
        <header class="drawer-head">
          <p class="eyebrow">Goal<template v-if="data"> · {{ data.goal.status }}</template></p>
          <button ref="closeButton" type="button" class="icon-button touch" aria-label="Close goal details" @click="emit('close', true)">
            <X :size="20" aria-hidden="true" />
          </button>
        </header>
        <div class="drawer-body">
          <LoadingState v-if="status === 'pending' && !data" />
          <ErrorState v-else-if="error || !data" @retry="refresh" />
          <template v-else>
            <div>
              <h2 :id="titleId" class="drawer-title">{{ data.goal.title }}</h2>
              <p class="drawer-desc">{{ data.goal.description || 'A meaningful outcome you are working toward.' }}</p>
            </div>
            <div class="drawer-progress">
              <ProgressRing :value="data.goal.progress" :size="96" label="Goal progress" caption />
              <dl class="drawer-facts">
                <div><dt>Status</dt><dd>{{ data.goal.status }}</dd></div>
                <div><dt>Target</dt><dd>{{ data.goal.targetDate ? formatDate(data.goal.targetDate) : 'No date' }}</dd></div>
                <div><dt>Tasks</dt><dd>{{ data.goal.taskCount === 0 ? 'None yet' : `${data.goal.completedTaskCount} of ${data.goal.taskCount}` }}</dd></div>
                <div><dt>Projects</dt><dd>{{ data.goal.projectCount }}</dd></div>
              </dl>
            </div>
            <section class="drawer-next" aria-labelledby="drawer-next-heading">
              <h3 id="drawer-next-heading" class="eyebrow">Next step</h3>
              <p>{{ data.goal.progress === null ? 'Nothing is planned yet, so progress is not measured. Kobi can turn this into projects and tasks for you to review.' : 'Ask Kobi what to do next. It proposes changes and nothing is saved until you accept.' }}</p>
              <button type="button" class="button" @click="askKobi">
                <Sparkles :size="16" aria-hidden="true" /> {{ data.goal.progress === null ? 'Plan this goal with Kobi' : 'Ask Kobi' }}
              </button>
            </section>
            <section aria-labelledby="drawer-projects-heading">
              <h3 id="drawer-projects-heading" class="eyebrow">Projects and milestones</h3>
              <p v-if="!data.projects.length" class="drawer-empty">No projects yet. Goal, then project, then milestone, then task. Every level is optional.</p>
              <ul v-else class="drawer-projects">
                <li v-for="project in data.projects" :key="project.id">
                  <div class="drawer-project-top">
                    <NuxtLink :to="`/projects/${project.id}`" class="drawer-project-name">{{ project.title }} <ArrowRight :size="14" aria-hidden="true" /></NuxtLink>
                    <span>{{ project.progress === null ? 'Not measured' : `${project.progress}%` }}</span>
                  </div>
                  <div class="progress" :class="{ 'is-unmeasured': project.progress === null }" aria-hidden="true">
                    <span v-if="project.progress !== null" :style="{ width: `${project.progress}%` }" />
                  </div>
                  <ul v-if="project.milestones.length" class="drawer-milestones">
                    <li v-for="milestone in project.milestones" :key="milestone.id">
                      <span>{{ milestone.title }}</span>
                      <span class="drawer-milestone-meta">{{ milestone.targetDate ? `${formatDate(milestone.targetDate)} · ` : '' }}{{ milestone.progress === null ? 'Not measured' : `${milestone.progress}%` }}</span>
                    </li>
                  </ul>
                </li>
              </ul>
            </section>
            <NuxtLink :to="`/goals/${data.goal.id}`" class="button secondary drawer-full">Open full page <ArrowRight :size="16" aria-hidden="true" /></NuxtLink>
          </template>
        </div>
      </aside>
    </div>
  </Teleport>
</template>
