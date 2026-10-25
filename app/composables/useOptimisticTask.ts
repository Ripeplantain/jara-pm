import type { Task } from '#shared/types/domain'
import {
  beginPatch,
  emptyOverlayState,
  type OverlayState,
  rejectPatch,
  resolvePatch,
  settlePatch,
  type TaskPatch,
  withOverlay,
  withOverlayAll,
} from '#shared/utils/task-overlay'

/** The fields a row or panel is allowed to change inline. */
export type TaskMutation = Pick<
  Partial<Task>,
  'status' | 'priority' | 'dueDate' | 'scheduledFor' | 'assigneeId' | 'estimate' | 'recurrence' | 'selectedForToday' | 'title'
>

type PatchOptions = {
  /** Goes to PostHog as the flow name when the request fails. */
  flow: string
  /** Shown in the rollback toast. The default covers an ordinary field edit. */
  message?: string
}

/**
 * Every inline task mutation goes through here, so the change renders before the network settles
 * and rolls back as one piece if it does not.
 *
 * Generalises the `replaceTask` pattern that used to live in `app/pages/board.vue`: rather than
 * splicing a returned row into one page's array, the change is recorded in a shared overlay that
 * every surface merges at render time. A task shown four times on the Today page updates in all
 * four places in the same tick, without any page learning how to patch its own cache.
 *
 * The lifecycle rules live in `shared/utils/task-overlay.ts` as a pure state machine, which is
 * where they are tested: every path here ends either by clearing the task's entry or by handing
 * it to a newer mutation, so a guess can never outlive the request that made it.
 */
export const useOptimisticTask = () => {
  const state = useState<OverlayState>('kobi-task-overlay', emptyOverlayState)
  const { captureException } = useProductAnalytics()
  const { show } = useToasts()
  const { refreshTaskViews } = useTaskViews()

  /** Merges anything pending into a task before it is rendered. */
  const decorate = (task: Task): Task => withOverlay(task, state.value.patches)
  const decorateAll = (tasks: Task[]): Task[] => withOverlayAll(tasks, state.value.patches)

  const patch = async (task: Task, changes: TaskMutation, options: PatchOptions): Promise<Task | null> => {
    const taskId = task.id
    // The guess goes in first: this is the frame the person actually sees.
    const begun = beginPatch(state.value, taskId, changes)
    state.value = begun.state

    try {
      const server = await $fetch<Task>(`/api/tasks/${taskId}`, { method: 'PATCH', body: changes })
      state.value = resolvePatch(state.value, taskId, begun.ticket, server)
      // Refresh every surface showing this task, then drop the entry -- unless a newer mutation
      // has taken it over, which `settlePatch` checks.
      await refreshTaskViews()
      state.value = settlePatch(state.value, taskId, begun.ticket)
      return server
    } catch (error: unknown) {
      captureException(error, { flow: options.flow })
      // Drop the pending state so the server's own value shows through, then refresh to make
      // sure that value is current. Convergence matters more than keeping the guess: the one
      // unacceptable outcome is a rejected value staying on screen.
      state.value = rejectPatch(state.value, taskId, begun.ticket)
      // One toast per failure. The row itself returns to its previous value, so the message is
      // the only thing that has to explain what happened.
      show(options.message ?? 'Kobi could not save that change.')
      await refreshTaskViews()
      return null
    }
  }

  /**
   * Records a row the server has already returned -- used by surfaces that mutate through their
   * own endpoint, such as the label picker, so their result reaches every other list too.
   *
   * It takes a ticket like any other mutation, so it supersedes anything still in flight for
   * that task rather than being silently overwritten by an older response.
   */
  const adopt = async (server: Task) => {
    const begun = beginPatch(state.value, server.id, server)
    state.value = resolvePatch(begun.state, server.id, begun.ticket, server)
    await refreshTaskViews()
    state.value = settlePatch(state.value, server.id, begun.ticket)
  }

  /** Forgets every pending guess. Used when the workspace changes and all lists are replaced. */
  const resetOverlay = () => {
    state.value = emptyOverlayState()
  }

  return { patch, decorate, decorateAll, adopt, state, resetOverlay }
}

export type TaskPatchFn = ReturnType<typeof useOptimisticTask>['patch']
export type { TaskPatch }
