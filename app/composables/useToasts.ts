export type ToastEntry = {
  id: string
  message: string
  actionLabel?: string
}

export type UndoableToast = {
  message: string
  actionLabel?: string
  /** Runs when the toast expires or is dismissed: the real, irreversible work. */
  onCommit: () => void | Promise<void>
  /** Runs when the person takes the action back. The commit never happens. */
  onUndo?: () => void | Promise<void>
  /** Runs when the commit throws, so the caller can restore what it hid optimistically. */
  onCommitError?: (error: unknown) => void
  /**
   * Commit as soon as the route changes. True for work that belongs to the page being left, such
   * as a queued delete. False for a toast that is meant to travel with the person - archiving
   * navigates away, and its Undo has to survive the navigation that caused it.
   */
  flushOnNavigate?: boolean
  delayMs?: number
}

export const TOAST_DURATION_MS = 6_000

// Timers and callbacks are not serializable, so they cannot live in the useState payload that
// SSR hydrates. On the client this module scope lasts as long as the document, which is exactly
// the lifetime of a pending commit.
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const commits = new Map<string, () => void | Promise<void>>()
const undos = new Map<string, () => void | Promise<void>>()
const commitErrors = new Map<string, (error: unknown) => void>()
const navigationFlushIds = new Set<string>()

const forget = (id: string) => {
  const timer = timers.get(id)
  if (timer) clearTimeout(timer)
  timers.delete(id)
  commits.delete(id)
  undos.delete(id)
  commitErrors.delete(id)
  navigationFlushIds.delete(id)
}

export const useToasts = () => {
  const toasts = useState<ToastEntry[]>('kobi-toasts', () => [])
  // Rows hidden optimistically while their delete is still undoable. Kept here rather than in
  // each page so a list can filter them out without every page learning about deletion.
  const pendingTaskIds = useState<string[]>('kobi-pending-task-deletions', () => [])

  const remove = (id: string) => {
    toasts.value = toasts.value.filter(toast => toast.id !== id)
  }

  /** Runs the deferred work now. Used by expiry, manual dismissal and the navigation flush. */
  const commit = async (id: string) => {
    const run = commits.get(id)
    const onError = commitErrors.get(id)
    forget(id)
    remove(id)
    if (!run) return
    try {
      await run()
    } catch (error) {
      onError?.(error)
    }
  }

  const undo = async (id: string) => {
    const run = undos.get(id)
    forget(id)
    remove(id)
    await run?.()
  }

  const push = (entry: ToastEntry, delayMs: number) => {
    toasts.value = [...toasts.value, entry]
    if (import.meta.client) {
      timers.set(entry.id, setTimeout(() => void commit(entry.id), delayMs))
    }
  }

  /** A plain acknowledgement with no deferred work. */
  const show = (message: string) => {
    push({ id: crypto.randomUUID(), message }, TOAST_DURATION_MS)
  }

  /**
   * Apple's guidance prefers a reversible action over a confirmation prompt, so the caller
   * applies the change immediately and hands the irreversible half here. It runs only once the
   * window closes.
   */
  const showUndo = (toast: UndoableToast) => {
    const id = crypto.randomUUID()
    commits.set(id, toast.onCommit)
    if (toast.onUndo) undos.set(id, toast.onUndo)
    if (toast.onCommitError) commitErrors.set(id, toast.onCommitError)
    if (toast.flushOnNavigate) navigationFlushIds.add(id)
    push({ id, message: toast.message, actionLabel: toast.actionLabel ?? 'Undo' }, toast.delayMs ?? TOAST_DURATION_MS)
  }

  /**
   * Commits everything still waiting, used when the document is going away. A full reload or a
   * closed tab can still cut a commit short, which leaves the original row intact - the safe
   * direction, since nothing is lost.
   */
  const flushPending = async () => {
    await Promise.all([...commits.keys()].map(id => commit(id)))
  }

  const hideTask = (taskId: string) => {
    if (!pendingTaskIds.value.includes(taskId)) pendingTaskIds.value = [...pendingTaskIds.value, taskId]
  }

  const revealTask = (taskId: string) => {
    pendingTaskIds.value = pendingTaskIds.value.filter(id => id !== taskId)
  }

  /**
   * A committed delete stays hidden rather than being revealed the instant the request returns,
   * because the list it was filtered out of refreshes asynchronously and the row would flash back.
   * The ids are inert once the server stops returning them, so the registry is emptied at the next
   * navigation - after flushPending, so nothing still queued is discarded.
   */
  const prunePendingTasks = async () => {
    await Promise.all([...navigationFlushIds].map(id => commit(id)))
    pendingTaskIds.value = []
  }

  return {
    toasts, pendingTaskIds, show, showUndo, commit, undo,
    flushPending, hideTask, revealTask, prunePendingTasks,
  }
}
