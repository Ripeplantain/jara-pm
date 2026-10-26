import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KobiDatabase } from '../server/db'
import { aiProposals, aiProposalSnapshots, taskDaySelections, tasks, users } from '../server/db/schema'
import { acceptProposal, undoReschedule } from '../server/services/ai'
import { createStatus, deleteStatus, statusForCategory } from '../server/services/statuses'
import { createTask, deleteTask, getTask, updateTask } from '../server/services/tasks'
import { rescheduleSnapshotSchema } from '../shared/schemas/ai'
import type { Proposal, RescheduleProposal } from '../shared/types/domain'
import { initializeDatabase } from '../server/utils/database'
import { todayIso } from '../server/utils/time'
import { createWorkspaceForUser } from './workspace-fixtures'

const dateAfter = (days: number) => {
  const date = new Date(`${todayIso()}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

describe('undo for an accepted reschedule', () => {
  let sqlite: Database.Database
  let db: KobiDatabase
  const userId = 'abababab-abab-4bab-8bab-abababababab'
  const otherUserId = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd'
  let workspaceId: string
  let otherWorkspaceId: string

  beforeEach(() => {
    vi.stubGlobal('createError', ({ statusText }: { statusText: string }) => new Error(statusText))
    sqlite = new Database(':memory:')
    db = initializeDatabase(sqlite)
    const now = '2026-01-01T00:00:00.000Z'
    for (const [id, email] of [[userId, 'a@example.test'], [otherUserId, 'b@example.test']] as const) {
      db.insert(users).values({ id, email, name: email, passwordHash: 'hash', createdAt: now, updatedAt: now }).run()
    }
    workspaceId = createWorkspaceForUser(db, userId)
    otherWorkspaceId = createWorkspaceForUser(db, otherUserId)
  })

  afterEach(() => {
    sqlite.close()
    vi.unstubAllGlobals()
  })

  const task = (title: string, dueDate: string | null, extra: { statusId?: string, selectedForToday?: boolean, scheduledFor?: string | null } = {}) =>
    createTask(db, userId, workspaceId, {
      title, description: '', priority: 'none', dueDate, scheduledFor: extra.scheduledFor ?? null, recurrence: 'none',
      selectedForToday: extra.selectedForToday ?? false, estimate: null, labelIds: [], assigneeId: userId,
      projectId: null, milestoneId: null, parentId: null, ...(extra.statusId ? { statusId: extra.statusId } : {}),
    })

  const store = (id: string, proposal: Proposal, owner = userId, workspace = workspaceId, status: 'pending' | 'accepted' | 'rejected' = 'pending') => {
    db.insert(aiProposals).values({
      id, userId: owner, workspaceId: workspace, kind: proposal.kind, payloadJson: JSON.stringify(proposal),
      status, createdAt: '2026-01-01T00:00:00.000Z',
    }).run()
  }

  const reschedule = (changes: Array<Partial<RescheduleProposal['changes'][number]> & { taskId: string }>): RescheduleProposal => ({
    kind: 'reschedule',
    note: '',
    changes: changes.map(change => ({
      dueDate: dateAfter(2), scheduledFor: dateAfter(1), selectedForToday: true, statusCategory: null, reason: '', ...change,
    })),
  })

  const accept = (id: string, proposal: RescheduleProposal) => {
    store(id, proposal)
    return acceptProposal(db, userId, workspaceId, id)
  }

  const undo = (id: string, user = userId, workspace = workspaceId) => undoReschedule(db, user, workspace, id)
  const snapshotRow = (id: string) => db.select().from(aiProposalSnapshots).where(eq(aiProposalSnapshots.proposalId, id)).get()
  const selection = (taskId: string) => db.select().from(taskDaySelections).where(eq(taskDaySelections.taskId, taskId)).all()

  it('captures the exact before and after of every changed task in the accept transaction', () => {
    const first = task('First', '2026-01-01')
    const second = task('Second', '2026-01-02', { selectedForToday: true, scheduledFor: '2026-01-03' })
    const result = accept('p1', reschedule([
      { taskId: first.id },
      { taskId: second.id, dueDate: null, scheduledFor: null, selectedForToday: false, statusCategory: 'backlog' },
    ]))

    expect(result).toEqual({ kind: 'reschedule', taskIds: [first.id, second.id] })
    const row = snapshotRow('p1')!
    expect(row).toMatchObject({ userId, workspaceId, undoneAt: null })
    const backlog = statusForCategory(db, workspaceId, 'backlog')!
    expect(rescheduleSnapshotSchema.parse(JSON.parse(row.snapshotJson))).toEqual([
      {
        taskId: first.id,
        before: { dueDate: '2026-01-01', scheduledFor: null, statusId: first.status.id, selectedForToday: false },
        after: { dueDate: dateAfter(2), scheduledFor: dateAfter(1), statusId: first.status.id, selectedForToday: true },
      },
      {
        taskId: second.id,
        before: { dueDate: '2026-01-02', scheduledFor: '2026-01-03', statusId: second.status.id, selectedForToday: true },
        after: { dueDate: null, scheduledFor: null, statusId: backlog.id, selectedForToday: false },
      },
    ])
  })

  it('restores dates, status and Today selection', () => {
    const first = task('First', '2026-01-01')
    const second = task('Second', '2026-01-02', { selectedForToday: true, scheduledFor: '2026-01-03' })
    accept('p1', reschedule([
      { taskId: first.id },
      { taskId: second.id, dueDate: null, scheduledFor: null, selectedForToday: false, statusCategory: 'backlog' },
    ]))
    expect(selection(first.id)).toHaveLength(1)
    expect(selection(second.id)).toHaveLength(0)

    expect(undo('p1')).toEqual({ undone: true, taskIds: [first.id, second.id] })

    expect(getTask(db, userId, workspaceId, first.id)).toMatchObject({ dueDate: '2026-01-01', scheduledFor: null, selectedForToday: false })
    expect(getTask(db, userId, workspaceId, second.id)).toMatchObject({ dueDate: '2026-01-02', scheduledFor: '2026-01-03', selectedForToday: true })
    expect(getTask(db, userId, workspaceId, second.id).status.id).toBe(second.status.id)
    expect(selection(first.id)).toHaveLength(0)
    expect(selection(second.id)).toHaveLength(1)
    expect(snapshotRow('p1')?.undoneAt).not.toBeNull()
  })

  it('records one entry per task when an edited proposal lists a task twice', () => {
    const first = task('First', '2026-01-01')
    accept('p1', reschedule([{ taskId: first.id, dueDate: dateAfter(3) }, { taskId: first.id, dueDate: dateAfter(4) }]))
    expect(JSON.parse(snapshotRow('p1')!.snapshotJson)).toHaveLength(1)
    undo('p1')
    expect(getTask(db, userId, workspaceId, first.id).dueDate).toBe('2026-01-01')
  })

  it('rolls the whole undo back when a later task cannot be restored', () => {
    const first = task('First', '2026-01-01')
    const review = createStatus(db, userId, workspaceId, { name: 'In review', category: 'started' })
    const second = task('Second', '2026-01-02', { statusId: review.id })
    accept('p1', reschedule([{ taskId: first.id }, { taskId: second.id, statusCategory: 'backlog' }]))
    // The original status of the second task no longer exists, so restoring it must fail cleanly.
    deleteStatus(db, userId, workspaceId, review.id)

    expect(() => undo('p1')).toThrow()

    expect(getTask(db, userId, workspaceId, first.id)).toMatchObject({ dueDate: dateAfter(2), selectedForToday: true })
    expect(selection(first.id)).toHaveLength(1)
    expect(getTask(db, userId, workspaceId, second.id).status.category).toBe('backlog')
    expect(snapshotRow('p1')?.undoneAt).toBeNull()
  })

  it('refuses when a due date or schedule changed after the replan', () => {
    const first = task('First', '2026-01-01')
    accept('p1', reschedule([{ taskId: first.id }]))
    updateTask(db, userId, workspaceId, first.id, { dueDate: dateAfter(5) })
    expect(() => undo('p1')).toThrowError('changed after the replan')
    expect(getTask(db, userId, workspaceId, first.id).dueDate).toBe(dateAfter(5))

    const second = task('Second', '2026-01-01')
    accept('p2', reschedule([{ taskId: second.id }]))
    updateTask(db, userId, workspaceId, second.id, { scheduledFor: dateAfter(6) })
    expect(() => undo('p2')).toThrowError('changed after the replan')
  })

  it('refuses when the status or Today selection changed after the replan', () => {
    const first = task('First', '2026-01-01')
    accept('p1', reschedule([{ taskId: first.id }]))
    const done = statusForCategory(db, workspaceId, 'completed')!
    updateTask(db, userId, workspaceId, first.id, { statusId: done.id })
    expect(() => undo('p1')).toThrowError('changed after the replan')

    const second = task('Second', '2026-01-01')
    accept('p2', reschedule([{ taskId: second.id }]))
    updateTask(db, userId, workspaceId, second.id, { selectedForToday: false })
    expect(() => undo('p2')).toThrowError('changed after the replan')
  })

  it('ignores edits to fields outside the four rescheduled ones', () => {
    const first = task('First', '2026-01-01')
    accept('p1', reschedule([{ taskId: first.id }]))
    updateTask(db, userId, workspaceId, first.id, { title: 'Renamed', priority: 'high' })
    expect(() => undo('p1')).not.toThrow()
    expect(getTask(db, userId, workspaceId, first.id)).toMatchObject({ title: 'Renamed', priority: 'high', dueDate: '2026-01-01' })
  })

  it('refuses when a task was deleted, and changes nothing', () => {
    const first = task('First', '2026-01-01')
    const second = task('Second', '2026-01-02')
    accept('p1', reschedule([{ taskId: first.id }, { taskId: second.id }]))
    deleteTask(db, userId, workspaceId, second.id)
    expect(() => undo('p1')).toThrowError('no longer exists')
    expect(getTask(db, userId, workspaceId, first.id).dueDate).toBe(dateAfter(2))
    expect(snapshotRow('p1')?.undoneAt).toBeNull()
  })

  it('refuses a second reschedule that touched the same task, then allows undoing in reverse order', () => {
    const first = task('First', '2026-01-01')
    accept('p1', reschedule([{ taskId: first.id, dueDate: dateAfter(2) }]))
    accept('p2', reschedule([{ taskId: first.id, dueDate: dateAfter(9) }]))
    expect(() => undo('p1')).toThrowError('changed after the replan')
    undo('p2')
    undo('p1')
    expect(getTask(db, userId, workspaceId, first.id).dueDate).toBe('2026-01-01')
  })

  it('refuses to undo twice', () => {
    const first = task('First', '2026-01-01')
    accept('p1', reschedule([{ taskId: first.id }]))
    undo('p1')
    expect(() => undo('p1')).toThrowError('already undone')
  })

  it('does not reveal or undo another user or workspace proposal', () => {
    const first = task('First', '2026-01-01')
    accept('p1', reschedule([{ taskId: first.id }]))
    expect(() => undo('p1', otherUserId, otherWorkspaceId)).toThrowError('Nothing to undo')
    expect(() => undo('p1', otherUserId, workspaceId)).toThrowError('Nothing to undo')
    expect(() => undo('p1', userId, otherWorkspaceId)).toThrowError('Nothing to undo')
    expect(getTask(db, userId, workspaceId, first.id).dueDate).toBe(dateAfter(2))
  })

  it('has nothing to undo for triage, goal_plan, pending or rejected proposals', () => {
    const first = task('First', '2026-01-01')
    store('triage', { kind: 'triage', taskId: first.id, labelIds: [], priority: 'high', projectId: null, estimate: null, reason: '' })
    acceptProposal(db, userId, workspaceId, 'triage')
    store('plan', {
      kind: 'goal_plan', goal: { title: 'G', description: '', targetDate: null },
      projects: [{ title: 'P', description: '', milestones: [{ title: 'M', targetDate: null, tasks: [{ title: 'T', dueDate: null, priority: 'none' }] }] }],
    })
    acceptProposal(db, userId, workspaceId, 'plan')
    store('pending', reschedule([{ taskId: first.id }]))
    store('rejected', reschedule([{ taskId: first.id }]), userId, workspaceId, 'rejected')
    for (const id of ['triage', 'plan', 'pending', 'rejected', 'missing']) {
      expect(() => undo(id)).toThrowError('Nothing to undo')
    }
    expect(db.select().from(aiProposalSnapshots).all()).toHaveLength(0)
  })

  it('does not clear startedAt or completedAt when restoring', () => {
    const started = statusForCategory(db, workspaceId, 'started')!
    const first = task('First', '2026-01-01', { statusId: started.id })
    const startedAt = getTask(db, userId, workspaceId, first.id).startedAt
    expect(startedAt).not.toBeNull()
    accept('p1', reschedule([{ taskId: first.id, statusCategory: 'backlog' }]))
    undo('p1')
    const restored = getTask(db, userId, workspaceId, first.id)
    expect(restored.status.id).toBe(started.id)
    expect(restored.startedAt).toBe(startedAt)
    expect(restored.completedAt).toBeNull()
  })

  it('keeps the snapshot row out of tasks (no foreign key to tasks)', () => {
    const first = task('First', '2026-01-01')
    accept('p1', reschedule([{ taskId: first.id }]))
    deleteTask(db, userId, workspaceId, first.id)
    expect(db.select().from(tasks).where(eq(tasks.id, first.id)).all()).toHaveLength(0)
    expect(snapshotRow('p1')).toBeDefined()
  })
})
