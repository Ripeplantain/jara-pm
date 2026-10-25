import type { UpdateTaskInput } from '#shared/schemas/task'
import type { Task } from '#shared/types/domain'

/**
 * A partial task carrying only the fields a mutation touched. `undefined` is never stored: a
 * field that is absent means "unchanged", and a field that was genuinely cleared is stored as
 * `null`, which is what the API returns for it.
 */
export type TaskPatch = Partial<Task>

/**
 * The fields a row or panel may change inline, in display shape -- `status` is the whole `Status`
 * object here, because that is what a row renders.
 */
export type TaskMutation = Pick<
  Partial<Task>,
  'status' | 'priority' | 'dueDate' | 'scheduledFor' | 'assigneeId' | 'estimate' | 'recurrence' | 'selectedForToday' | 'title'
>

/**
 * Which request field each display field is sent as. The overlay and the wire disagree about
 * status: a row renders the whole `Status` object, while the API accepts only `statusId`.
 *
 * This map is the drift guard, and it has to be a map rather than a spread. `updateTaskSchema`
 * has no `.strict()`, so a display-only field that reached the body -- `labels`, `key`,
 * `projectTitle` -- would be silently stripped by Zod: the overlay would show a guess the server
 * never stored, then revert it on the next refresh, with no error anywhere. Being a mapped type
 * over `keyof Required<TaskMutation>`, every key must appear here, so widening `TaskMutation`
 * without deciding how the new field is sent is a compile error. A field with no wire equivalent
 * is mapped to `null` deliberately rather than dropped by accident.
 */
const WIRE_FIELD: { [K in keyof Required<TaskMutation>]: keyof UpdateTaskInput | null } = {
  status: 'statusId',
  title: 'title',
  priority: 'priority',
  dueDate: 'dueDate',
  scheduledFor: 'scheduledFor',
  assigneeId: 'assigneeId',
  estimate: 'estimate',
  recurrence: 'recurrence',
  selectedForToday: 'selectedForToday',
}

/** The request body for a display-shaped mutation. */
export const taskMutationBody = (changes: TaskMutation): Partial<UpdateTaskInput> => {
  const body: Record<string, unknown> = {}
  for (const key of Object.keys(changes) as Array<keyof TaskMutation>) {
    const field = WIRE_FIELD[key]
    if (!field) continue
    body[field] = key === 'status' ? changes.status?.id : changes[key]
  }
  return body as Partial<UpdateTaskInput>
}

/** Pending local changes, keyed by task id. */
export type TaskOverlay = Record<string, TaskPatch>

/**
 * The overlay plus one ticket counter per task.
 *
 * The counter is what makes concurrent edits to the same task safe. Every mutation takes the
 * next ticket, and only the holder of the current ticket may change or clear that task's entry,
 * so a slow response can neither overwrite a newer one nor roll back an edit it never saw.
 */
export type OverlayState = {
  patches: TaskOverlay
  tickets: Record<string, number>
}

export const emptyOverlayState = (): OverlayState => ({ patches: {}, tickets: {} })

/**
 * The optimistic overlay exists because a task is rendered from several independent caches --
 * `today-dashboard` splits one task across four arrays, and the board, inbox and upcoming lists
 * each hold their own copy. Writing the change into every one of them is what made mutations
 * wait for a refetch. Instead the change is recorded once here and merged at render time, so
 * every surface showing that task updates in the same tick.
 */
export const withOverlay = (task: Task, overlay: TaskOverlay): Task => {
  const patch = overlay[task.id]
  return patch ? { ...task, ...patch } : task
}

export const withOverlayAll = (tasks: Task[], overlay: TaskOverlay): Task[] => {
  // Identity is preserved when nothing applies, so `v-for` keys and Vue's render cache are not
  // invalidated for untouched rows.
  if (Object.keys(overlay).length === 0) return tasks
  return tasks.map(task => withOverlay(task, overlay))
}

/**
 * Merges a patch over whatever is already pending for that task. Merging rather than replacing
 * is what lets two quick edits to different fields of one task both survive.
 */
export const setPatch = (overlay: TaskOverlay, taskId: string, patch: TaskPatch): TaskOverlay => ({
  ...overlay,
  [taskId]: { ...overlay[taskId], ...patch },
})

export const clearPatch = (overlay: TaskOverlay, taskId: string): TaskOverlay => {
  if (!(taskId in overlay)) return overlay
  const { [taskId]: _removed, ...rest } = overlay
  return rest
}

/** True when `ticket` is still the newest mutation issued for this task. */
export const isCurrentTicket = (state: OverlayState, taskId: string, ticket: number): boolean =>
  state.tickets[taskId] === ticket

/**
 * Records an optimistic guess and returns the ticket that owns it.
 *
 * `adopt`-style writes take a ticket too, so a row the server already returned also supersedes
 * anything older that is still in flight.
 */
export const beginPatch = (
  state: OverlayState,
  taskId: string,
  patch: TaskPatch,
): { state: OverlayState, ticket: number } => {
  const ticket = (state.tickets[taskId] ?? 0) + 1
  return {
    ticket,
    state: {
      patches: setPatch(state.patches, taskId, patch),
      tickets: { ...state.tickets, [taskId]: ticket },
    },
  }
}

/**
 * The server accepted the change. Its response replaces the guess outright rather than merging
 * into it: the row that came back is complete, and it carries fields the caller never sent --
 * recurrence rolls the due date forward, and `selectedForToday` writes a separate day-selection
 * row.
 */
export const resolvePatch = (
  state: OverlayState,
  taskId: string,
  ticket: number,
  server: Task,
): OverlayState => {
  if (!isCurrentTicket(state, taskId, ticket)) return state
  return { ...state, patches: { ...state.patches, [taskId]: { ...server } } }
}

/**
 * The server rejected the change, so the task's pending state is dropped entirely and the list's
 * own data shows through again.
 *
 * Dropping everything rather than restoring the previous guess is deliberate. The previous guess
 * may itself be a failed write -- two rejected edits in a row would otherwise leave the first
 * one's value on screen for the life of the document, which is the one outcome worse than a
 * brief flicker. The caller refreshes after a failure, so whatever the server really holds
 * arrives a moment later.
 */
export const rejectPatch = (state: OverlayState, taskId: string, ticket: number): OverlayState => {
  if (!isCurrentTicket(state, taskId, ticket)) return state
  return { ...state, patches: clearPatch(state.patches, taskId) }
}

/**
 * The surfaces showing this task have been refreshed, so the entry has done its job. A newer
 * mutation takes ownership of the entry, so this is a no-op once one has been issued.
 */
export const settlePatch = (state: OverlayState, taskId: string, ticket: number): OverlayState => {
  if (!isCurrentTicket(state, taskId, ticket)) return state
  return { ...state, patches: clearPatch(state.patches, taskId) }
}
