import type { Component } from 'vue'
import { rankActions } from '#shared/utils/command-score'

/**
 * A ceiling on rendered rows. With every project, goal, label and member contributing an action,
 * a blank query can rank into the hundreds, and nobody scrolls a palette -- they type. The cap
 * applies after ranking, so the best matches are always the ones kept.
 */
const MAX_RESULTS = 60

export type CommandAction = {
  /** Stable across re-registration, so the highlighted row survives a re-render. */
  id: string
  label: string
  /** The section the action is listed under, and a matchable term in its own right. */
  group: string
  icon?: Component
  /** Terms that should find the action without being shown on it. */
  keywords?: string[]
  /** Hides the action when it does not apply, for example a task action with no focused task. */
  when?: () => boolean
  run: () => void | Promise<void>
}

/**
 * Registered actions, and a revision counter that makes the derived list reactive.
 *
 * Actions hold functions and component references, so they cannot live in `useState`: that
 * payload is serialized for hydration. Module scope lasts as long as the document, which is the
 * right lifetime, and `registerActions` is a no-op on the server so nothing leaks between
 * requests -- the palette is a client-only surface and never renders during SSR.
 */
const registry = new Map<string, CommandAction[]>()
const revision = ref(0)

const bump = () => { revision.value += 1 }

export const useCommandPalette = () => {
  const isOpen = useState<boolean>('kobi-palette-open', () => false)
  const query = useState<string>('kobi-palette-query', () => '')

  /**
   * Registers a group of actions under an owner key and removes them when the calling component
   * goes away, so a page's contextual actions cannot outlive the page.
   */
  const registerActions = (owner: string, actions: MaybeRefOrGetter<CommandAction[]>) => {
    if (!import.meta.client) return

    watchEffect(() => {
      registry.set(owner, toValue(actions))
      bump()
    })

    onScopeDispose(() => {
      registry.delete(owner)
      bump()
    })
  }

  /** Every registered action that currently applies, before the query is taken into account. */
  const available = computed<CommandAction[]>(() => {
    void revision.value
    return [...registry.values()].flat().filter(action => action.when?.() ?? true)
  })

  const results = computed(() => rankActions(query.value, available.value).slice(0, MAX_RESULTS))

  const open = () => {
    query.value = ''
    isOpen.value = true
  }

  const close = () => {
    isOpen.value = false
    query.value = ''
  }

  const toggle = () => (isOpen.value ? close() : open())

  return { isOpen, query, results, available, registerActions, open, close, toggle }
}

/**
 * Binds Cmd/Ctrl+K for the whole app. Lives in the default layout, which only authenticated
 * pages use -- the sign-in and sign-up screens render under `public`, so the palette genuinely
 * cannot be opened there rather than merely being hidden.
 *
 * The palette component itself is mounted only while open, like `AskKobiPanel`, so none of the
 * data its actions need is fetched until someone asks for it.
 */
export const useCommandShortcut = () => {
  const { toggle, isOpen, close } = useCommandPalette()

  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      toggle()
      return
    }
    // Escape is handled here as well as in the dialog so it still closes when focus has
    // wandered outside the panel.
    if (event.key === 'Escape' && isOpen.value) close()
  }

  onMounted(() => window.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
}
