import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KobiDatabase } from '../server/db'
import { aiMessages, aiProposals, users } from '../server/db/schema'
import {
  acceptProposal,
  INVALID_REPLY_NOTICE,
  OFFLINE_NOTICE,
  OFFLINE_RESCHEDULE_PER_DAY,
  rescheduleOverdue,
} from '../server/services/ai'
import { createTask, getTask } from '../server/services/tasks'
import { rescheduleProposalSchema } from '../shared/schemas/ai'
import type { AiReplySource, TaskPriority } from '../shared/types/domain'
import { initializeDatabase } from '../server/utils/database'
import { createWorkspaceForUser } from './workspace-fixtures'

const TODAY = '2026-06-10'

vi.mock('../server/utils/time', () => ({
  nowIso: () => new Date().toISOString(),
  todayIso: () => TODAY,
}))

describe('offline reschedule', () => {
  let sqlite: Database.Database
  let db: KobiDatabase
  const userId = 'abababab-abab-4bab-8bab-abababababab'
  let workspaceId: string
  const noKey = { apiKey: '', baseUrl: 'https://provider.test', model: 'test-model' }
  const withKey = { ...noKey, apiKey: 'test-key' }

  beforeEach(() => {
    vi.stubGlobal('createError', ({ statusText }: { statusText: string }) => new Error(statusText))
    sqlite = new Database(':memory:')
    db = initializeDatabase(sqlite)
    const now = '2026-01-01T00:00:00.000Z'
    db.insert(users).values({ id: userId, email: 'offline@example.test', name: 'Offline', passwordHash: 'hash', createdAt: now, updatedAt: now }).run()
    workspaceId = createWorkspaceForUser(db, userId)
  })

  afterEach(() => {
    sqlite.close()
    vi.unstubAllGlobals()
  })

  const task = (title: string, dueDate: string, priority: TaskPriority = 'none', selectedForToday = false) =>
    createTask(db, userId, workspaceId, {
      title, description: '', priority, dueDate, scheduledFor: null, recurrence: 'none',
      selectedForToday, estimate: null, labelIds: [], assigneeId: userId,
      projectId: null, milestoneId: null, parentId: null,
    })

  const pendingRows = () => db.select().from(aiProposals).all()

  it('is deterministic and orders by priority, then days overdue, then key', async () => {
    const low = task('low old', '2026-05-01', 'low')
    const high = task('high recent', '2026-06-09', 'high')
    const highOlder = task('high older', '2026-06-01', 'high')
    const medium = task('medium', '2026-05-20', 'medium')
    const fetchSpy = vi.fn()
    vi.stubGlobal('$fetch', fetchSpy)

    const first = await rescheduleOverdue(db, userId, workspaceId, noKey)
    const second = await rescheduleOverdue(db, userId, workspaceId, noKey)

    expect(first.proposal?.changes.map(change => change.taskId)).toEqual([highOlder.id, high.id, medium.id, low.id])
    expect(second.proposal?.changes).toEqual(first.proposal?.changes)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('caps each day, shrinks today by what is already selected, and stays inside the horizon', async () => {
    task('already today', '2026-06-09', 'none', true)
    for (let index = 0; index < 8; index++) task(`overdue ${index}`, '2026-06-01', 'medium')

    const reply = await rescheduleOverdue(db, userId, workspaceId, noKey)
    const changes = reply.proposal!.changes
    const perDay = new Map<string, number>()
    for (const change of changes) perDay.set(change.dueDate!, (perDay.get(change.dueDate!) ?? 0) + 1)

    // The already-selected task is itself overdue, so it is a candidate too: 9 tasks.
    expect(changes).toHaveLength(9)
    expect(Math.max(...perDay.values())).toBeLessThanOrEqual(OFFLINE_RESCHEDULE_PER_DAY)
    expect(perDay.get(TODAY) ?? 0).toBeLessThanOrEqual(OFFLINE_RESCHEDULE_PER_DAY - 1)
    for (const change of changes) {
      expect(change.dueDate! >= TODAY && change.dueDate! <= '2026-06-24').toBe(true)
      expect(change.scheduledFor).toBe(change.dueDate)
      expect(change.selectedForToday).toBe(change.dueDate === TODAY)
      expect(change.statusCategory).toBeNull()
    }
    expect(rescheduleProposalSchema.safeParse(reply.proposal).success).toBe(true)
  })

  it('leaves candidates beyond the change limit out and says so in the note', async () => {
    for (let index = 0; index < 24; index++) task(`overdue ${index}`, '2026-06-01')
    const reply = await rescheduleOverdue(db, userId, workspaceId, noKey)
    expect(reply.proposal!.changes).toHaveLength(20)
    expect(reply.proposal!.note).toContain('4 more overdue tasks were left out')
  })

  it('saves exactly one pending offline proposal and leaves tasks unchanged until accepted', async () => {
    const overdue = task('Late', '2026-06-01', 'high')
    const reply = await rescheduleOverdue(db, userId, workspaceId, noKey)

    expect(reply.source satisfies AiReplySource).toBe('offline')
    expect(reply.message.startsWith(OFFLINE_NOTICE)).toBe(true)
    expect(pendingRows()).toHaveLength(1)
    expect(pendingRows()[0]).toMatchObject({ id: reply.proposalId, kind: 'reschedule', status: 'pending' })
    expect(db.select().from(aiMessages).all()).toHaveLength(0)
    expect(getTask(db, userId, workspaceId, overdue.id).dueDate).toBe('2026-06-01')

    acceptProposal(db, userId, workspaceId, reply.proposalId!)
    expect(getTask(db, userId, workspaceId, overdue.id)).toMatchObject({ dueDate: TODAY, selectedForToday: true })
    expect(db.select({ status: aiProposals.status }).from(aiProposals).where(eq(aiProposals.id, reply.proposalId!)).get()?.status).toBe('accepted')
  })

  it('treats a network error like a missing key', async () => {
    task('Late', '2026-06-01', 'high')
    const offline = await rescheduleOverdue(db, userId, workspaceId, noKey)
    vi.stubGlobal('$fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const unreachable = await rescheduleOverdue(db, userId, workspaceId, withKey)
    expect(unreachable.source).toBe('offline')
    expect(unreachable.proposal).toEqual(offline.proposal)
    expect(unreachable.message).toBe(offline.message)
  })

  it('still reports a contract-breaking model reply as invalid with no row', async () => {
    task('Late', '2026-06-01')
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ choices: [{ message: { content: 'not json' } }] }))
    const reply = await rescheduleOverdue(db, userId, workspaceId, withKey)
    expect(reply).toEqual({ message: INVALID_REPLY_NOTICE, proposalId: null, proposal: null, source: 'invalid' })
    expect(pendingRows()).toHaveLength(0)
  })

  it('reports offline with no row when there is no key and nothing is overdue', async () => {
    const reply = await rescheduleOverdue(db, userId, workspaceId, noKey)
    expect(reply).toEqual({ message: OFFLINE_NOTICE, proposalId: null, proposal: null, source: 'offline' })
    expect(pendingRows()).toHaveLength(0)
  })

  it('keeps AiReplySource a three-member union', () => {
    const sources = { model: 0, offline: 0, invalid: 0 } satisfies Record<AiReplySource, number>
    expect(Object.keys(sources)).toHaveLength(3)
  })
})
