import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KobiDatabase } from '../server/db'
import { aiMessages, aiProposals, taskDaySelections, users, workspaceMembers, workspaces } from '../server/db/schema'
import {
  acceptProposal,
  INVALID_REPLY_NOTICE,
  OFFLINE_NOTICE,
  rejectProposal,
  rescheduleOverdue,
  triageTask,
} from '../server/services/ai'
import { createProject } from '../server/services/projects'
import { createTask, getTask } from '../server/services/tasks'
import { acceptProposalSchema, proposalSchema } from '../shared/schemas/ai'
import type { RescheduleProposal, TriageProposal } from '../shared/types/domain'
import { initializeDatabase } from '../server/utils/database'
import { todayIso } from '../server/utils/time'
import { createWorkspaceForUser } from './workspace-fixtures'

describe('additional AI proposal kinds', () => {
  let sqlite: Database.Database
  let db: KobiDatabase
  const userId = 'abababab-abab-4bab-8bab-abababababab'
  let workspaceId: string

  beforeEach(() => {
    vi.stubGlobal('createError', ({ statusText }: { statusText: string }) => new Error(statusText))
    sqlite = new Database(':memory:')
    db = initializeDatabase(sqlite)
    const now = '2026-01-01T00:00:00.000Z'
    db.insert(users).values({ id: userId, email: 'kinds@example.test', name: 'Kinds', passwordHash: 'hash', createdAt: now, updatedAt: now }).run()
    workspaceId = createWorkspaceForUser(db, userId)
  })

  afterEach(() => {
    sqlite.close()
    vi.unstubAllGlobals()
  })

  const task = (title: string, dueDate: string | null = null) => createTask(db, userId, workspaceId, {
    title, description: '', priority: 'none', dueDate, scheduledFor: null, recurrence: 'none',
    selectedForToday: false, estimate: null, labelIds: [], assigneeId: userId,
    projectId: null, milestoneId: null, parentId: null,
  })

  const store = (id: string, proposal: TriageProposal | RescheduleProposal) => {
    db.insert(aiProposals).values({
      id, userId, workspaceId, kind: proposal.kind, payloadJson: JSON.stringify(proposal),
      status: 'pending', createdAt: '2026-01-01T00:00:00.000Z',
    }).run()
  }

  const config = { apiKey: 'test-key', baseUrl: 'https://provider.test', model: 'test-model' }
  const completion = (content: unknown) => ({
    choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }],
  })

  it('parses all proposal kinds and keeps the legacy plan accept body', () => {
    expect(proposalSchema.safeParse({ kind: 'unknown' }).success).toBe(false)
    expect(acceptProposalSchema.parse({})).toEqual({})
    expect(acceptProposalSchema.safeParse({
      plan: { kind: 'goal_plan', goal: { title: 'G', description: '', targetDate: null }, projects: [] },
    }).success).toBe(false)
    const triage: TriageProposal = {
      kind: 'triage', taskId: crypto.randomUUID(), labelIds: [], priority: 'none', projectId: null, estimate: null, reason: '',
    }
    expect(acceptProposalSchema.safeParse({
      plan: {
        kind: 'goal_plan',
        goal: { title: 'Goal', description: '', targetDate: null },
        projects: [{
          title: 'Project', description: '', milestones: [{
            title: 'Milestone', targetDate: null,
            tasks: [{ title: 'Task', dueDate: null, priority: 'none' }],
          }],
        }],
      },
      proposal: triage,
    }).success).toBe(false)
  })

  it('keeps a provider triage proposal pending and the task unchanged until acceptance', async () => {
    const originalTask = task('Provider triage')
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(completion({
      message: 'A small change will make this actionable.',
      proposal: {
        kind: 'triage', taskId: originalTask.id, labelIds: [], priority: 'high',
        projectId: null, estimate: null, reason: 'This is time-sensitive.',
      },
    })))

    const reply = await triageTask(db, userId, workspaceId, { taskId: originalTask.id }, config)

    expect(reply).toMatchObject({ source: 'model', proposal: { kind: 'triage', priority: 'high' } })
    expect(reply.proposalId).not.toBeNull()
    expect(getTask(db, userId, workspaceId, originalTask.id).priority).toBe('none')
    expect(db.select({ status: aiProposals.status }).from(aiProposals)
      .where(eq(aiProposals.id, reply.proposalId!)).get()).toEqual({ status: 'pending' })
    expect(db.select().from(aiMessages).all()).toHaveLength(0)
  })

  it('propagates a database failure while persisting an action proposal instead of reporting offline', async () => {
    const originalTask = task('Persistence must be honest')
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(completion({
      message: 'Raise the priority.',
      proposal: {
        kind: 'triage', taskId: originalTask.id, labelIds: [], priority: 'high',
        projectId: null, estimate: null, reason: 'This matters now.',
      },
    })))
    sqlite.exec(`
      create trigger fail_action_proposal
      before insert on ai_proposals
      begin
        select raise(abort, 'db write failed');
      end;
    `)

    await expect(triageTask(db, userId, workspaceId, { taskId: originalTask.id }, config))
      .rejects.toThrow('db write failed')
    expect(db.select().from(aiProposals).all()).toHaveLength(0)
    expect(getTask(db, userId, workspaceId, originalTask.id).priority).toBe('none')
  })

  it('reports offline and invalid action replies without persisting proposals or messages', async () => {
    const originalTask = task('Source contract', '2020-01-01')

    const offline = await triageTask(db, userId, workspaceId, { taskId: originalTask.id }, { ...config, apiKey: '' })
    expect(offline).toEqual({ message: OFFLINE_NOTICE, proposalId: null, proposal: null, source: 'offline' })

    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(completion('not json')))
    const invalid = await triageTask(db, userId, workspaceId, { taskId: originalTask.id }, config)
    expect(invalid).toEqual({ message: INVALID_REPLY_NOTICE, proposalId: null, proposal: null, source: 'invalid' })

    vi.stubGlobal('$fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const unavailable = await rescheduleOverdue(db, userId, workspaceId, config)
    expect(unavailable).toEqual({ message: OFFLINE_NOTICE, proposalId: null, proposal: null, source: 'offline' })
    expect(db.select().from(aiProposals).all()).toHaveLength(0)
    expect(db.select().from(aiMessages).all()).toHaveLength(0)
  })

  it('keeps triage inert until acceptance and applies the edited payload', () => {
    const originalTask = task('Sort me')
    const project = createProject(db, userId, workspaceId, { title: 'Home', description: '', goalId: null, targetDate: null })
    const stored: TriageProposal = {
      kind: 'triage', taskId: originalTask.id, labelIds: [], priority: 'low', projectId: null, estimate: null, reason: 'A suggestion',
    }
    store('triage-proposal', stored)
    expect(getTask(db, userId, workspaceId, originalTask.id).priority).toBe('none')

    acceptProposal(db, userId, workspaceId, 'triage-proposal', {
      proposal: { ...stored, priority: 'high', projectId: project.id },
    })

    expect(getTask(db, userId, workspaceId, originalTask.id)).toMatchObject({ priority: 'high', projectId: project.id })
    expect(db.select({ status: aiProposals.status }).from(aiProposals).where(eq(aiProposals.id, 'triage-proposal')).get()?.status).toBe('accepted')
  })

  it('forces an edited triage estimate to null when estimates are disabled', () => {
    const originalTask = task('No estimates here')
    const proposal: TriageProposal = {
      kind: 'triage', taskId: originalTask.id, labelIds: [], priority: 'low', projectId: null, estimate: null, reason: '',
    }
    store('estimate-none', proposal)

    acceptProposal(db, userId, workspaceId, 'estimate-none', {
      proposal: { ...proposal, estimate: 5 },
    })

    expect(getTask(db, userId, workspaceId, originalTask.id).estimate).toBeNull()
  })

  it('does not persist an edited triage estimate outside the workspace scale', () => {
    db.update(workspaces).set({ estimateScale: 'linear' }).where(eq(workspaces.id, workspaceId)).run()
    const originalTask = task('Respect the scale')
    const proposal: TriageProposal = {
      kind: 'triage', taskId: originalTask.id, labelIds: [], priority: 'low', projectId: null, estimate: null, reason: '',
    }
    store('estimate-off-scale', proposal)

    acceptProposal(db, userId, workspaceId, 'estimate-off-scale', {
      proposal: { ...proposal, estimate: 13 },
    })

    expect(getTask(db, userId, workspaceId, originalTask.id).estimate).toBeNull()
  })

  it('persists an edited triage estimate that belongs to the workspace scale', () => {
    db.update(workspaces).set({ estimateScale: 'linear' }).where(eq(workspaces.id, workspaceId)).run()
    const originalTask = task('Use a valid estimate')
    const proposal: TriageProposal = {
      kind: 'triage', taskId: originalTask.id, labelIds: [], priority: 'low', projectId: null, estimate: null, reason: '',
    }
    store('estimate-on-scale', proposal)

    acceptProposal(db, userId, workspaceId, 'estimate-on-scale', {
      proposal: { ...proposal, estimate: 5 },
    })

    expect(getTask(db, userId, workspaceId, originalTask.id).estimate).toBe(5)
  })

  it('accepts a reschedule atomically and updates Today selection', () => {
    const first = task('First', '2026-01-01')
    const second = task('Second', '2026-01-02')
    const dateAfter = (days: number) => {
      const date = new Date(`${todayIso()}T00:00:00.000Z`)
      date.setUTCDate(date.getUTCDate() + days)
      return date.toISOString().slice(0, 10)
    }
    const proposal: RescheduleProposal = {
      kind: 'reschedule', note: 'Spread the work', changes: [first, second].map((item, index) => ({
        taskId: item.id,
        dueDate: dateAfter(index + 2),
        scheduledFor: index === 0 ? dateAfter(1) : null,
        selectedForToday: index === 0,
        statusCategory: index === 1 ? 'backlog' : null,
        reason: 'Make it realistic',
      })),
    }
    store('reschedule-proposal', proposal)

    acceptProposal(db, userId, workspaceId, 'reschedule-proposal')

    expect(getTask(db, userId, workspaceId, first.id)).toMatchObject({ dueDate: dateAfter(2), scheduledFor: dateAfter(1), selectedForToday: true })
    expect(getTask(db, userId, workspaceId, second.id).status.category).toBe('backlog')
    expect(db.select().from(taskDaySelections).where(eq(taskDaySelections.taskId, first.id)).all()).toHaveLength(1)
  })

  it('rolls back every reschedule change and keeps the proposal pending when a later task is inaccessible', () => {
    const first = task('Must roll back', '2026-01-01')
    const otherUserId = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd'
    const now = '2026-01-01T00:00:00.000Z'
    db.insert(users).values({ id: otherUserId, email: 'other@example.test', name: 'Other', passwordHash: 'hash', createdAt: now, updatedAt: now }).run()
    const otherWorkspaceId = createWorkspaceForUser(db, otherUserId)
    const inaccessible = createTask(db, otherUserId, otherWorkspaceId, {
      title: 'Other workspace', description: '', priority: 'none', dueDate: '2026-01-01', scheduledFor: null,
      recurrence: 'none', selectedForToday: false, estimate: null, labelIds: [], assigneeId: otherUserId,
      projectId: null, milestoneId: null, parentId: null,
    })
    const proposal: RescheduleProposal = {
      kind: 'reschedule', note: 'Atomic change', changes: [first.id, inaccessible.id].map(taskId => ({
        taskId, dueDate: '2026-01-10', scheduledFor: null, selectedForToday: true, statusCategory: null, reason: '',
      })),
    }
    store('rollback-reschedule', proposal)

    expect(() => acceptProposal(db, userId, workspaceId, 'rollback-reschedule')).toThrow()

    expect(getTask(db, userId, workspaceId, first.id)).toMatchObject({ dueDate: '2026-01-01', selectedForToday: false })
    expect(db.select({ status: aiProposals.status }).from(aiProposals)
      .where(eq(aiProposals.id, 'rollback-reschedule')).get()?.status).toBe('pending')
    expect(db.select().from(taskDaySelections).where(eq(taskDaySelections.taskId, first.id)).all()).toHaveLength(0)
  })

  it('rejects an edited reschedule date outside the two-week horizon without resolving the proposal', () => {
    const originalTask = task('Keep the horizon', '2026-01-01')
    const proposal: RescheduleProposal = {
      kind: 'reschedule', note: '', changes: [{
        taskId: originalTask.id, dueDate: null, scheduledFor: null,
        selectedForToday: false, statusCategory: null, reason: '',
      }],
    }
    store('reschedule-horizon', proposal)
    const outsideHorizon = new Date(`${todayIso()}T00:00:00.000Z`)
    outsideHorizon.setUTCDate(outsideHorizon.getUTCDate() + 15)

    expect(() => acceptProposal(db, userId, workspaceId, 'reschedule-horizon', {
      proposal: {
        ...proposal,
        changes: [{ ...proposal.changes[0]!, dueDate: outsideHorizon.toISOString().slice(0, 10) }],
      },
    })).toThrowError('two-week horizon')
    expect(db.select({ status: aiProposals.status }).from(aiProposals)
      .where(eq(aiProposals.id, 'reschedule-horizon')).get()?.status).toBe('pending')
    expect(getTask(db, userId, workspaceId, originalTask.id).dueDate).toBe('2026-01-01')
  })

  it('rejects cross-workspace project ids without mutating or resolving a triage proposal', () => {
    const originalTask = task('Stay isolated')
    const otherUserId = 'efefefef-efef-4fef-8fef-efefefefefef'
    const now = '2026-01-01T00:00:00.000Z'
    db.insert(users).values({ id: otherUserId, email: 'project@example.test', name: 'Project owner', passwordHash: 'hash', createdAt: now, updatedAt: now }).run()
    const otherWorkspaceId = createWorkspaceForUser(db, otherUserId)
    const foreignProject = createProject(db, otherUserId, otherWorkspaceId, { title: 'Foreign', description: '', goalId: null, targetDate: null })
    const proposal: TriageProposal = {
      kind: 'triage', taskId: originalTask.id, labelIds: [], priority: 'high', projectId: foreignProject.id, estimate: null, reason: '',
    }
    store('foreign-project', proposal)

    expect(() => acceptProposal(db, userId, workspaceId, 'foreign-project')).toThrow()
    expect(getTask(db, userId, workspaceId, originalTask.id)).toMatchObject({ priority: 'none', projectId: null })
    expect(db.select({ status: aiProposals.status }).from(aiProposals)
      .where(eq(aiProposals.id, 'foreign-project')).get()?.status).toBe('pending')
  })

  it('does not let a second member move another user\'s shared project task into their private Inbox', () => {
    const memberId = '12121212-1212-4212-8212-121212121212'
    const now = '2026-01-01T00:00:00.000Z'
    db.insert(users).values({
      id: memberId, email: 'member@example.test', name: 'Member', passwordHash: 'hash',
      activeWorkspaceId: workspaceId, createdAt: now, updatedAt: now,
    }).run()
    db.insert(workspaceMembers).values({ workspaceId, userId: memberId, role: 'member', joinedAt: now }).run()
    const project = createProject(db, userId, workspaceId, {
      title: 'Shared project', description: '', goalId: null, targetDate: null,
    })
    const sharedTask = createTask(db, userId, workspaceId, {
      title: 'Owner-created shared task', description: '', priority: 'none', dueDate: null, scheduledFor: null,
      recurrence: 'none', selectedForToday: false, estimate: null, labelIds: [], assigneeId: userId,
      projectId: project.id, milestoneId: null, parentId: null,
    })
    const proposal: TriageProposal = {
      kind: 'triage', taskId: sharedTask.id, labelIds: [], priority: 'high',
      projectId: null, estimate: null, reason: 'Move to my Inbox',
    }
    db.insert(aiProposals).values({
      id: 'member-private-move', userId: memberId, workspaceId, kind: proposal.kind,
      payloadJson: JSON.stringify(proposal), status: 'pending', createdAt: now,
    }).run()

    expect(() => acceptProposal(db, memberId, workspaceId, 'member-private-move')).toThrow()
    expect(getTask(db, userId, workspaceId, sharedTask.id)).toMatchObject({
      projectId: project.id,
      priority: 'none',
    })
    expect(db.select({ status: aiProposals.status }).from(aiProposals)
      .where(eq(aiProposals.id, 'member-private-move')).get()?.status).toBe('pending')
  })

  it('rejects a pending proposal without touching its task', () => {
    const originalTask = task('Leave me')
    const proposal: TriageProposal = {
      kind: 'triage', taskId: originalTask.id, labelIds: [], priority: 'high', projectId: null, estimate: null, reason: '',
    }
    store('reject-proposal', proposal)

    rejectProposal(db, userId, workspaceId, 'reject-proposal')

    expect(getTask(db, userId, workspaceId, originalTask.id).priority).toBe('none')
    expect(db.select({ status: aiProposals.status }).from(aiProposals).where(eq(aiProposals.id, 'reject-proposal')).get()?.status).toBe('rejected')
    expect(() => acceptProposal(db, userId, workspaceId, 'reject-proposal')).toThrowError('Proposal was already resolved')
  })

  it('rolls back an edited payload whose kind does not match', () => {
    const originalTask = task('Protected')
    const proposal: TriageProposal = {
      kind: 'triage', taskId: originalTask.id, labelIds: [], priority: 'high', projectId: null, estimate: null, reason: '',
    }
    store('kind-mismatch', proposal)
    const wrong: RescheduleProposal = {
      kind: 'reschedule', note: '', changes: [{ taskId: originalTask.id, dueDate: null, scheduledFor: null, selectedForToday: false, statusCategory: null, reason: '' }],
    }

    expect(() => acceptProposal(db, userId, workspaceId, 'kind-mismatch', { proposal: wrong })).toThrowError('Edited proposal kind does not match')
    expect(db.select({ status: aiProposals.status }).from(aiProposals).where(eq(aiProposals.id, 'kind-mismatch')).get()?.status).toBe('pending')
    expect(getTask(db, userId, workspaceId, originalTask.id).priority).toBe('none')
  })

  it('rolls back a stored kind/payload mismatch', () => {
    const originalTask = task('Stored mismatch')
    const proposal: TriageProposal = {
      kind: 'triage', taskId: originalTask.id, labelIds: [], priority: 'high', projectId: null, estimate: null, reason: '',
    }
    store('stored-kind-mismatch', proposal)
    db.update(aiProposals).set({ kind: 'reschedule' }).where(eq(aiProposals.id, 'stored-kind-mismatch')).run()

    expect(() => acceptProposal(db, userId, workspaceId, 'stored-kind-mismatch')).toThrowError('Stored proposal kind does not match')
    expect(db.select({ status: aiProposals.status }).from(aiProposals)
      .where(eq(aiProposals.id, 'stored-kind-mismatch')).get()?.status).toBe('pending')
    expect(getTask(db, userId, workspaceId, originalTask.id).priority).toBe('none')
  })
})
