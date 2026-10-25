/**
 * Whether the viewport is narrow enough that a side panel covers the page instead of sitting
 * beside it.
 *
 * The breakpoint is deliberately the same 620px as the `.task-panel { width: 100% }` rule in
 * `app/assets/css/main.css`: above it the panel is a non-blocking side panel and the list stays
 * usable beside it, below it the panel owns the screen and has to behave like a dialog. The two
 * have to agree, or the panel would claim to be modal while the list is still visible, or cover
 * the list while leaving it reachable by keyboard.
 */
const COMPACT_QUERY = '(max-width: 620px)'

export const useCompactViewport = () => {
  // False on the server: SSR has no viewport, and the panel's non-modal markup is the safer of
  // the two to send before hydration corrects it.
  const isCompact = useState<boolean>('kobi-compact-viewport', () => false)

  if (import.meta.client) {
    const media = window.matchMedia(COMPACT_QUERY)
    const update = (event: MediaQueryList | MediaQueryListEvent) => { isCompact.value = event.matches }

    onMounted(() => {
      update(media)
      media.addEventListener('change', update)
    })
    onBeforeUnmount(() => media.removeEventListener('change', update))
  }

  return { isCompact }
}
