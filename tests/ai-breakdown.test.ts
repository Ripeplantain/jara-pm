import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KobiDatabase } from '../server/db'
import { aiProposals, tasks, users, workspaceMembers } from '../server/db/schema'
import {
  acceptProposal,
  breakdownContextFor,
  breakdownProject,
  buildBreakdownProviderRequest,
  INVALID_REPLY_NOTICE,
  OFFLINE_NOTICE,
} from '../server/services/ai'
import { createMilestone, createProject, getProject, updateProject } from '../server/services/projects'
import { createTask } from '../server/services/tasks'
import {
  aiReplyJsonSchema,
  breakdownProposalSchema,
  breakdownReplyJsonSchema,
  PLAN_BOUNDS,
  proposalSchema,
} from '../shared/schemas/ai'
import type { BreakdownProposal } from '../shared/types/domain'
import { initializeDatabase } from '../server/utils/database'
import aiReplyJsonSchemaBefore from './fixtures/ai-reply-json-schema.json'
import { createWorkspaceForUser } from './workspace-fixtures'

describe('breakdown proposals', () => {
  let sqlite: Database.Database
  let db: KobiDatabase
  const userId = 'abababab-abab-4bab-8bab-abababababab'
  const otherUserId = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd'
  let workspaceId: string
  let otherWorkspaceId: string
  let projectId: string
  const config = { apiKey: 'test-key', baseUrl: 'https://provider.test', model: 'test-model' }

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
    projectId = createProject(db, userId, workspaceId, { title: 'Launch site', description: 'Ship the marketing site', goalId: null, targetDate: null }).id
  })

  afterEach(() => {
    sqlite.close()
    vi.unstubAllGlobals()
  })

  const proposal = (overrides: Partial<BreakdownProposal> = {}): BreakdownProposal => ({
    kind: 'breakdown',
    projectId,
    milestones: [
      { title: 'Design', targetDate: null, tasks: [{ title: 'Wireframes', dueDate: null, priority: 'high' }, { title: 'Style guide', dueDate: null, priority: 'low' }] },
      { title: 'Build', targetDate: '2026-12-01', tasks: [{ title: 'Homepage', dueDate: '2026-11-20', priority: 'medium' }] },
    ],
    ...overrides,
  })
  const completion = (content: unknown) => ({
    choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }],
  })
  const store = (id: string, value: BreakdownProposal, owner = userId, workspace = workspaceId) => {
    db.insert(aiProposals).values({
      id, userId: owner, workspaceId: workspace, kind: value.kind, payloadJson: JSON.stringify(value),
      status: 'pending', createdAt: '2026-01-01T00:00:00.000Z',
    }).run()
  }
  const status = (id: string) => db.select({ status: aiProposals.status }).from(aiProposals).where(eq(aiProposals.id, id)).get()?.status
  const projectTasks = () => db.select().from(tasks).where(eq(tasks.projectId, projectId)).all()

  // getProject throws h3's real createError, whose text lives in statusMessage rather than message.
  const failureText = async (run: () => unknown) => {
    try {
      await run()
    } catch (error) {
      const failure = error as { statusMessage?: string, message?: string }
      return failure.statusMessage || failure.message
    }
    return null
  }

  it('adds a fourth kind to the proposal union', () => {
    expect(proposalSchema.options.map(option => option.shape.kind.value).sort())
      .toEqual(['breakdown', 'goal_plan', 'reschedule', 'triage'])
    expect(proposalSchema.safeParse(proposal()).success).toBe(true)
    expect(breakdownProposalSchema.safeParse({ ...proposal(), milestones: [] }).success).toBe(false)
  })

  it('keeps the goal_plan provider JSON schema identical after sharing the milestone subtree', () => {
    expect(aiReplyJsonSchema).toEqual(aiReplyJsonSchemaBefore)
    const milestones = (breakdownReplyJsonSchema.properties.proposal.anyOf[1] as { properties: { milestones: unknown } }).properties.milestones
    const goalPlan = (aiReplyJsonSchema.properties.proposal.anyOf[1] as { properties: { projects: { items: { properties: { milestones: unknown } } } } })
    expect(milestones).toEqual(goalPlan.properties.projects.items.properties.milestones)
  })

  it('builds a context from the project, bounded and fenced', () => {
    updateProject(db, userId, workspaceId, projectId, { description: 'x'.repeat(5_000) })
    createMilestone(db, userId, workspaceId, projectId, { title: 'Existing', description: '', targetDate: null })
    for (let index = 0; index < 45; index++) {
      createTask(db, userId, workspaceId, {
        title: `Open ${index}`, description: '', priority: 'none', dueDate: null, scheduledFor: null, recurrence: 'none',
        selectedForToday: false, estimate: null, labelIds: [], assigneeId: userId, projectId, milestoneId: null, parentId: null,
      })
    }
    const context = breakdownContextFor(db, userId, workspaceId, projectId)
    expect(context.project.description).toHaveLength(4_000)
    expect(context.openTaskTitles).toHaveLength(40)
    expect(context.existingMilestones).toEqual([{ title: 'Existing', targetDate: null, taskCount: 0 }])
    const request = buildBreakdownProviderRequest(config, context)
    expect(request.messages[1]?.content).toBe(`UNTRUSTED_APPLICATION_CONTEXT\n${JSON.stringify(context)}\nEND_CONTEXT`)
    expect(request.response_format.json_schema).toMatchObject({ strict: true, schema: breakdownReplyJsonSchema })
  })

  it('keeps a provider breakdown pending and the project unchanged until acceptance', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(completion({ message: 'Here is a breakdown.', proposal: proposal() })))
    const reply = await breakdownProject(db, userId, workspaceId, { projectId }, config)

    expect(reply).toMatchObject({ source: 'model', proposal: { kind: 'breakdown', projectId } })
    expect(status(reply.proposalId!)).toBe('pending')
    expect(getProject(db, userId, workspaceId, projectId).milestones).toHaveLength(0)
    expect(projectTasks()).toHaveLength(0)
  })

  it('accepts an edited breakdown into the existing project and keeps the original payload', () => {
    store('bd', proposal())
    const edited = proposal({ milestones: [{ title: 'Edited milestone', targetDate: null, tasks: [{ title: 'Edited task', dueDate: null, priority: 'high' }] }] })

    const result = acceptProposal(db, userId, workspaceId, 'bd', { proposal: edited })

    expect(result).toMatchObject({ kind: 'breakdown', projectId })
    expect('milestoneIds' in result && result.milestoneIds).toHaveLength(1)
    const after = getProject(db, userId, workspaceId, projectId)
    expect(after.milestones.map(milestone => milestone.title)).toEqual(['Edited milestone'])
    expect(projectTasks()).toMatchObject([{ title: 'Edited task', assigneeId: userId, milestoneId: after.milestones[0]!.id }])
    expect(status('bd')).toBe('accepted')
    const row = db.select({ payload: aiProposals.payloadJson }).from(aiProposals).where(eq(aiProposals.id, 'bd')).get()!
    expect(JSON.parse(row.payload)).toEqual(proposal())
  })

  it('accepts the stored breakdown unedited and assigns every task to the requester', () => {
    store('bd', proposal())
    acceptProposal(db, userId, workspaceId, 'bd')
    expect(getProject(db, userId, workspaceId, projectId).milestones.map(milestone => milestone.title)).toEqual(['Design', 'Build'])
    expect(projectTasks()).toHaveLength(3)
    expect(projectTasks().every(task => task.assigneeId === userId)).toBe(true)
  })

  it('rolls back and stays pending when a task fails mid-accept', () => {
    store('bd', proposal({
      milestones: [
        { title: 'First', targetDate: null, tasks: [{ title: 'Fine', dueDate: null, priority: 'none' }] },
        { title: 'Second', targetDate: null, tasks: [{ title: 'BOOM', dueDate: null, priority: 'none' }] },
      ],
    }))
    sqlite.exec(`create trigger boom before insert on tasks when new.title = 'BOOM' begin select raise(abort, 'insert failed'); end;`)

    expect(() => acceptProposal(db, userId, workspaceId, 'bd')).toThrow('insert failed')

    expect(status('bd')).toBe('pending')
    expect(getProject(db, userId, workspaceId, projectId).milestones).toHaveLength(0)
    expect(projectTasks()).toHaveLength(0)
  })

  it('refuses another workspace project and an archived project at accept time', async () => {
    const foreign = createProject(db, otherUserId, otherWorkspaceId, { title: 'Foreign', description: '', goalId: null, targetDate: null })
    store('foreign', proposal({ projectId: foreign.id }))
    expect(await failureText(() => acceptProposal(db, userId, workspaceId, 'foreign'))).toBe('Project not found')
    expect(status('foreign')).toBe('pending')

    store('archived', proposal())
    updateProject(db, userId, workspaceId, projectId, { status: 'archived' })
    expect(() => acceptProposal(db, userId, workspaceId, 'archived')).toThrowError('Archived projects')
    expect(status('archived')).toBe('pending')
    expect(getProject(db, userId, workspaceId, projectId).milestones).toHaveLength(0)
  })

  it('refuses to draft for an archived or foreign project without calling the provider', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('$fetch', fetchSpy)
    const foreign = createProject(db, otherUserId, otherWorkspaceId, { title: 'Foreign', description: '', goalId: null, targetDate: null })
    expect(await failureText(() => breakdownProject(db, userId, workspaceId, { projectId: foreign.id }, config))).toBe('Project not found')
    updateProject(db, userId, workspaceId, projectId, { status: 'archived' })
    await expect(breakdownProject(db, userId, workspaceId, { projectId }, config)).rejects.toThrowError('Archived projects')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rolls back an edited payload of another kind', () => {
    store('bd', proposal())
    expect(() => acceptProposal(db, userId, workspaceId, 'bd', {
      proposal: { kind: 'triage', taskId: crypto.randomUUID(), labelIds: [], priority: 'none', projectId: null, estimate: null, reason: '' },
    })).toThrowError('Edited proposal kind does not match')
    expect(status('bd')).toBe('pending')
  })

  it('does not let another workspace member accept someone else\'s breakdown', () => {
    const memberId = '12121212-1212-4212-8212-121212121212'
    const now = '2026-01-01T00:00:00.000Z'
    db.insert(users).values({ id: memberId, email: 'm@example.test', name: 'M', passwordHash: 'h', activeWorkspaceId: workspaceId, createdAt: now, updatedAt: now }).run()
    db.insert(workspaceMembers).values({ workspaceId, userId: memberId, role: 'member', joinedAt: now }).run()
    store('bd', proposal())
    expect(() => acceptProposal(db, memberId, workspaceId, 'bd')).toThrowError('Proposal not found')
    expect(status('bd')).toBe('pending')
  })

  it('reports offline with no proposal row when no provider is available', async () => {
    const offline = await breakdownProject(db, userId, workspaceId, { projectId }, { ...config, apiKey: '' })
    expect(offline).toEqual({ message: OFFLINE_NOTICE, proposalId: null, proposal: null, source: 'offline' })
    vi.stubGlobal('$fetch', vi.fn().mockRejectedValue(new Error('network down')))
    expect(await breakdownProject(db, userId, workspaceId, { projectId }, config)).toMatchObject({ source: 'offline', proposal: null, proposalId: null })
    expect(db.select().from(aiProposals).all()).toHaveLength(0)
  })

  it('reports an invalid reply without drafting anything', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(completion('not json')))
    expect(await breakdownProject(db, userId, workspaceId, { projectId }, config))
      .toEqual({ message: INVALID_REPLY_NOTICE, proposalId: null, proposal: null, source: 'invalid' })
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(completion({ message: 'x', proposal: { ...proposal(), milestones: [] } })))
    expect((await breakdownProject(db, userId, workspaceId, { projectId }, config)).source).toBe('invalid')
    expect(db.select().from(aiProposals).all()).toHaveLength(0)
  })

  it('answers with no proposal when the model names a different projectId', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(completion({ message: 'Here.', proposal: proposal({ projectId: crypto.randomUUID() }) })))
    const reply = await breakdownProject(db, userId, workspaceId, { projectId }, config)
    expect(reply).toMatchObject({ source: 'model', proposal: null, proposalId: null })
    expect(db.select().from(aiProposals).all()).toHaveLength(0)
  })

  it('trims an over-bounds reply to the stored bounds instead of discarding it', async () => {
    const many = Array.from({ length: PLAN_BOUNDS.milestonesPerProject + 3 }, (_, index) => ({
      title: `M${index}`, targetDate: null,
      tasks: Array.from({ length: PLAN_BOUNDS.tasksPerMilestone + 2 }, (_, taskIndex) => ({ title: `T${taskIndex}`, dueDate: null, priority: 'none' as const })),
    }))
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(completion({ message: 'Big.', proposal: proposal({ milestones: many }) })))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const reply = await breakdownProject(db, userId, workspaceId, { projectId }, config)
    expect(reply.proposal?.milestones).toHaveLength(PLAN_BOUNDS.milestonesPerProject)
    expect(reply.proposal?.milestones[0]?.tasks).toHaveLength(PLAN_BOUNDS.tasksPerMilestone)
  })
})
