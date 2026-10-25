import { describe, expect, it } from 'vitest'
import type { Label, Status, Task } from '../shared/types/domain'
import {
  beginPatch,
  clearPatch,
  emptyOverlayState,
  isCurrentTicket,
  type OverlayState,
  rejectPatch,
  resolvePatch,
  setPatch,
  settlePatch,
  taskMutationBody,
  withOverlay,
  withOverlayAll,
} from '../shared/utils/task-overlay'

const label = (id: string, name: string): Label => ({
  id,
  groupId: null,
  groupName: null,
  name,
  color: 'slate',
  description: '',
  archivedAt: null,
})

const todo: Status = { id: 'status-todo', name: 'Todo', category: 'unstarted', position: 1, isDefault: true }
const inProgress: Status = { id: 'status-doing', name: 'In Progress', category: 'started', position: 2, isDefault: false }
const done: Status = { id: 'status-done', name: 'Done', category: 'completed', position: 3, isDefault: false }

const task = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1',
  number: 1,
  key: 'T-1',
  title: 'Write the thing',
  description: '',
  status: todo,
  priority: 'none',
  dueDate: null,
  scheduledFor: null,
  recurrence: 'none',
  selectedForToday: false,
  assigneeId: null,
  assigneeName: null,
  assigneeEmail: null,
  projectId: null,
  projectTitle: null,
  milestoneId: null,
  milestoneTitle: null,
  parentId: null,
  estimate: null,
  labels: [],
  startedAt: null,
  completedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

/** What a surface would render for this task given the current overlay. */
const rendered = (state: OverlayState, row: Task = task()) => withOverlay(row, state.patches)

describe('task overlay merging', () => {
  it('leaves a task untouched when nothing is pending', () => {
    const original = task()
    expect(withOverlay(original, {})).toBe(original)
  })

  it('merges only the fields a patch carries', () => {
    const merged = withOverlay(task({ title: 'Original' }), { 'task-1': { status: done } })

    expect(merged.status).toBe(done)
    expect(merged.title).toBe('Original')
  })

  it('does not touch other tasks', () => {
    const other = task({ id: 'task-2' })
    expect(withOverlay(other, { 'task-1': { status: done } })).toBe(other)
  })

  it('keeps list identity when the overlay is empty', () => {
    const tasks = [task(), task({ id: 'task-2' })]
    expect(withOverlayAll(tasks, {})).toBe(tasks)
  })

  it('applies across a list without disturbing unmatched rows', () => {
    const tasks = [task(), task({ id: 'task-2', status: todo })]
    const result = withOverlayAll(tasks, { 'task-2': { status: inProgress } })

    expect(result[0]).toBe(tasks[0])
    expect(result[1]?.status).toBe(inProgress)
  })

  it('merges successive patches for the same task', () => {
    let overlay = setPatch({}, 'task-1', { status: inProgress })
    overlay = setPatch(overlay, 'task-1', { priority: 'high' })

    expect(withOverlay(task(), overlay)).toMatchObject({ status: inProgress, priority: 'high' })
  })

  it('stores a cleared field as null rather than dropping it', () => {
    const overlay = setPatch({}, 'task-1', { dueDate: null })
    expect(withOverlay(task({ dueDate: '2026-02-01' }), overlay).dueDate).toBeNull()
  })

  it('clears one task without disturbing the rest', () => {
    let overlay = setPatch({}, 'task-1', { status: done })
    overlay = setPatch(overlay, 'task-2', { status: done })

    const cleared = clearPatch(overlay, 'task-1')

    expect(cleared['task-1']).toBeUndefined()
    expect(cleared['task-2']).toEqual({ status: done })
  })

  it('returns the same object when there is nothing to clear', () => {
    const overlay = setPatch({}, 'task-1', { status: done })
    expect(clearPatch(overlay, 'task-2')).toBe(overlay)
  })
})

/**
 * The mutation lifecycle. These are the cases the composable's control flow produces, written as
 * the sequence of calls it makes, because this is where correctness actually lives: a guess that
 * outlives its request shows the person a value the server rejected.
 */
describe('task overlay lifecycle', () => {
  it('shows the guess immediately', () => {
    const { state } = beginPatch(emptyOverlayState(), 'task-1', { status: done })
    expect(rendered(state).status).toBe(done)
  })

  it('issues ascending tickets per task', () => {
    const first = beginPatch(emptyOverlayState(), 'task-1', { status: done })
    const second = beginPatch(first.state, 'task-1', { priority: 'high' })

    expect(first.ticket).toBe(1)
    expect(second.ticket).toBe(2)
    expect(isCurrentTicket(second.state, 'task-1', 1)).toBe(false)
    expect(isCurrentTicket(second.state, 'task-1', 2)).toBe(true)
  })

  it('counts tickets independently per task', () => {
    const one = beginPatch(emptyOverlayState(), 'task-1', { status: done })
    const two = beginPatch(one.state, 'task-2', { status: done })

    expect(two.ticket).toBe(1)
  })

  it('replaces the guess with the server row on success, then clears on refresh', () => {
    const begun = beginPatch(emptyOverlayState(), 'task-1', { status: done })
    // The server rolled the due date forward too -- a field the caller never sent.
    const server = task({ status: done, dueDate: '2026-03-03', updatedAt: 'later' })

    const resolved = resolvePatch(begun.state, 'task-1', begun.ticket, server)
    expect(rendered(resolved).dueDate).toBe('2026-03-03')

    const settled = settlePatch(resolved, 'task-1', begun.ticket)
    expect(settled.patches['task-1']).toBeUndefined()
  })

  // The defect this replaced: settling compared the server row against itself, so it always
  // succeeded and cleared the entry even on surfaces that had not been refreshed.
  it('does not settle an entry a newer mutation has taken over', () => {
    const first = beginPatch(emptyOverlayState(), 'task-1', { status: done })
    const second = beginPatch(first.state, 'task-1', { priority: 'high' })

    const settled = settlePatch(second.state, 'task-1', first.ticket)

    expect(settled).toBe(second.state)
    expect(rendered(settled).priority).toBe('high')
  })

  it('drops the guess when the server rejects it', () => {
    const begun = beginPatch(emptyOverlayState(), 'task-1', { status: done })

    const rejected = rejectPatch(begun.state, 'task-1', begun.ticket)

    expect(rejected.patches['task-1']).toBeUndefined()
    expect(rendered(rejected).status).toBe(todo)
  })

  // Two rejected writes in flight at once. The older rejection must not resurrect its own guess,
  // and the newer one must leave nothing behind: a rejected value staying on screen is the worst
  // available outcome.
  it('leaves nothing pending when two concurrent mutations both fail', () => {
    const first = beginPatch(emptyOverlayState(), 'task-1', { status: inProgress })
    const second = beginPatch(first.state, 'task-1', { status: done })

    let next = rejectPatch(second.state, 'task-1', second.ticket)
    next = rejectPatch(next, 'task-1', first.ticket)

    expect(next.patches['task-1']).toBeUndefined()
    expect(rendered(next).status).toBe(todo)
  })

  it('does not let a failure undo a newer mutation still in flight', () => {
    const first = beginPatch(emptyOverlayState(), 'task-1', { status: done })
    const second = beginPatch(first.state, 'task-1', { priority: 'high' })

    const next = rejectPatch(second.state, 'task-1', first.ticket)

    expect(rendered(next).priority).toBe('high')
  })

  // A success followed by a failure inside the refresh window used to restore the whole server
  // row and pin every field of the task for the life of the document.
  it('pins nothing when a failure follows a success', () => {
    const first = beginPatch(emptyOverlayState(), 'task-1', { status: done })
    const resolved = resolvePatch(first.state, 'task-1', first.ticket, task({ status: done }))

    const second = beginPatch(resolved, 'task-1', { priority: 'high' })
    let next = rejectPatch(second.state, 'task-1', second.ticket)
    // The earlier success settles afterwards and must not revive anything.
    next = settlePatch(next, 'task-1', first.ticket)

    expect(next.patches['task-1']).toBeUndefined()
  })

  it('ignores a stale response that arrives after a newer one', () => {
    const first = beginPatch(emptyOverlayState(), 'task-1', { status: inProgress })
    const second = beginPatch(first.state, 'task-1', { status: done })

    const latest = resolvePatch(second.state, 'task-1', second.ticket, task({ status: done }))
    const stale = resolvePatch(latest, 'task-1', first.ticket, task({ status: inProgress }))

    expect(rendered(stale).status).toBe(done)
  })

  it('lets an adopted server row supersede an older mutation in flight', () => {
    const inFlight = beginPatch(emptyOverlayState(), 'task-1', { status: done })

    // `adopt` takes its own ticket, which is what stops the older PATCH response winning.
    const adopted = beginPatch(inFlight.state, 'task-1', task({ labels: [label('l1', 'urgent')] }))
    const state = resolvePatch(adopted.state, 'task-1', adopted.ticket, task({ labels: [label('l1', 'urgent')] }))

    const stale = resolvePatch(state, 'task-1', inFlight.ticket, task({ status: done, labels: [] }))

    expect(rendered(stale).labels.map(entry => entry.id)).toEqual(['l1'])
  })

  it('forgets everything when the overlay is reset', () => {
    const begun = beginPatch(emptyOverlayState(), 'task-1', { status: done })
    expect(rendered(begun.state).status).toBe(done)
    expect(rendered(emptyOverlayState()).status).toBe(todo)
  })
})

describe('taskMutationBody', () => {
  // The overlay renders a whole Status object, but the API accepts only statusId.
  it('turns a status object into a statusId and never sends the object', () => {
    const body = taskMutationBody({ status: done })

    expect(body).toEqual({ statusId: 'status-done' })
    expect(body).not.toHaveProperty('status')
  })

  it('passes every other field through unchanged, including cleared ones', () => {
    expect(taskMutationBody({ status: inProgress, priority: 'high', dueDate: null }))
      .toEqual({ statusId: 'status-doing', priority: 'high', dueDate: null })
    expect(taskMutationBody({ title: 'Renamed' })).toEqual({ title: 'Renamed' })
  })

  it('leaves the overlay lifecycle alone: the guess still renders the object', () => {
    const { state } = beginPatch(emptyOverlayState(), 'task-1', { status: done })

    expect(rendered(state).status).toBe(done)
    expect(taskMutationBody({ status: done })).toEqual({ statusId: done.id })
  })
})
