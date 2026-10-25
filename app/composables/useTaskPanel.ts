import { parseTaskKey } from '#shared/utils/task-key'

/**
 * How many panel entries this document has pushed onto the history stack. Module scope rather
 * than `useState` because it describes this document's history, which never crosses an SSR
 * boundary.
 *
 * It decides how Escape behaves: a panel this session opened is closed with `back()`, so the
 * history stack does not grow an entry per open and the browser's back button does what the
 * person expects. A panel that arrived in a pasted URL has no entry of ours to return to, so it
 * is closed by replacing the URL instead -- going back there would leave the app entirely.
 *
 * A count rather than a flag because the stack can hold more than one: opening a subtask from
 * inside the panel pushes again, and closing that one should return to its parent.
 */
let pushedCount = 0

/**
 * Route-driven task detail: `?task=ACME-7` on any list page.
 *
 * The panel is rendered by the default layout, not by each page, so opening it changes only the
 * query string. Page components stay mounted and their `useFetch` keys are static, so the list
 * behind the panel is neither remounted nor refetched.
 */
export const useTaskPanel = () => {
  const route = useRoute()
  const router = useRouter()

  const requestedKey = computed(() => {
    const value = route.query.task
    return typeof value === 'string' && value.length > 0 ? value : null
  })

  // A malformed key is treated as no panel at all rather than as a lookup that will 404: this is
  // the same guard `app/pages/[taskKey].vue` applies through `definePageMeta.validate`.
  const openKey = computed(() => {
    const key = requestedKey.value
    return key && parseTaskKey(key) ? key : null
  })

  const isOpen = computed(() => openKey.value !== null)

  const openTask = async (key: string) => {
    if (route.query.task === key) return
    await router.push({ path: route.path, query: { ...route.query, task: key } })
    // Counted only once the navigation has actually happened: an aborted push would otherwise
    // leave a phantom entry and send a later close back out of the page.
    pushedCount += 1
  }

  const close = async () => {
    if (!requestedKey.value) return
    if (pushedCount > 0) {
      pushedCount -= 1
      router.back()
      return
    }
    const { task: _task, ...query } = route.query
    await router.replace({ path: route.path, query })
  }

  return { openKey, isOpen, openTask, close }
}
