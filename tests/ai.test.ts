import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { aiMessages, aiProposals, goals, milestones, projects, tasks, users, workspaceMembers, workspaces } from '../server/db/schema'
import type { KobiDatabase } from '../server/db'
import { acceptProposal, askKobi, INVALID_REPLY_NOTICE, localPlan, OFFLINE_NOTICE } from '../server/services/ai'
import type { GoalPlanProposal } from '../shared/types/domain'
import { goalPlanProposalSchema, PLAN_BOUNDS } from '../shared/schemas/ai'
import { MAX_TITLE_LENGTH } from '../shared/schemas/common'
import { initializeDatabase } from '../server/utils/database'
import { createWorkspaceForUser } from './workspace-fixtures'

describe('AI proposal persistence', () => {
  let sqlite: Database.Database
  let db: KobiDatabase
  const userId = '11111111-1111-4111-8111-111111111111'
  const proposalId = '33333333-3333-4333-8333-333333333333'

  beforeEach(() => {
    vi.stubGlobal('createError', ({ statusText }: { statusText: string }) => new Error(statusText))
    sqlite = new Database(':memory:')
    db = initializeDatabase(sqlite)
    db.insert(users).values({
      id: userId,
      email: 'one@example.test',
      name: 'One',
      passwordHash: 'test-hash',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }).run()
    createWorkspaceForUser(db, userId)
    db.insert(aiProposals).values({
      id: proposalId,
      userId,
      workspaceId: `workspace-${userId}`,
      kind: 'goal_plan',
      payloadJson: JSON.stringify({
        kind: 'goal_plan',
        goal: { title: 'Ship Kobi', description: 'Release the first version.', targetDate: null },
        projects: [{
          title: 'Prepare release',
          description: '',
          milestones: [{
            title: 'Launch checklist',
            targetDate: null,
            tasks: [{ title: 'Deploy the app', dueDate: null, priority: 'high' }],
          }],
        }],
      }),
      status: 'pending',
      createdAt: '2026-01-01T00:00:00.000Z',
    }).run()
  })

  afterEach(() => {
    sqlite.close()
    vi.unstubAllGlobals()
  })

  it('accepts the proposal and commits all related rows transactionally', () => {
    const result = acceptProposal(db, userId, proposalId)

    expect(result.projectIds).toHaveLength(1)
    expect(db.select({ status: aiProposals.status }).from(aiProposals)
      .where(eq(aiProposals.id, proposalId)).get()).toEqual({ status: 'accepted' })
    expect(db.select({ id: goals.id }).from(goals).where(eq(goals.userId, userId)).all()).toHaveLength(1)
    expect(db.select({ id: projects.id }).from(projects).where(eq(projects.userId, userId)).all()).toHaveLength(1)
    expect(db.select({ id: tasks.id }).from(tasks).where(eq(tasks.userId, userId)).all()).toHaveLength(1)
  })

  it('rejects replaying an already accepted proposal', () => {
    acceptProposal(db, userId, proposalId)

    expect(() => acceptProposal(db, userId, proposalId)).toThrowError('Proposal was already resolved')
    expect(db.select({ id: goals.id }).from(goals).where(eq(goals.userId, userId)).all()).toHaveLength(1)
    expect(db.select({ id: projects.id }).from(projects).where(eq(projects.userId, userId)).all()).toHaveLength(1)
    expect(db.select({ id: tasks.id }).from(tasks).where(eq(tasks.userId, userId)).all()).toHaveLength(1)
  })

  it('does not accept a proposal from another workspace', () => {
    const otherWorkspace = `workspace-other-${userId}`
    db.insert(workspaces).values({
      id: otherWorkspace,
      name: 'Other workspace',
      ownerId: userId,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }).run()
    db.insert(workspaceMembers).values({
      workspaceId: otherWorkspace,
      userId,
      role: 'owner',
      joinedAt: '2026-01-01T00:00:00.000Z',
    }).run()
    db.insert(aiProposals).values({
      id: 'proposal-other-workspace',
      userId,
      workspaceId: otherWorkspace,
      kind: 'goal_plan',
      payloadJson: '{}',
      status: 'pending',
      createdAt: '2026-01-01T00:00:00.000Z',
    }).run()

    expect(() => acceptProposal(db, userId, `workspace-${userId}`, 'proposal-other-workspace')).toThrowError('Proposal not found')
    expect(db.select({ id: goals.id }).from(goals).where(eq(goals.userId, userId)).all()).toHaveLength(0)
  })
})

describe('Edited plan acceptance', () => {
  let sqlite: Database.Database
  let db: KobiDatabase
  const userId = '66666666-6666-4666-8666-666666666666'
  const workspaceId = `workspace-${userId}`
  const proposalId = '77777777-7777-4777-8777-777777777777'
  const original: GoalPlanProposal = {
    kind: 'goal_plan',
    goal: { title: 'Ship Kobi', description: 'Release the first version.', targetDate: null },
    projects: [{
      title: 'Prepare release',
      description: '',
      milestones: [{
        title: 'Launch checklist',
        targetDate: '2026-03-01',
        tasks: [{ title: 'Deploy the app', dueDate: '2026-02-01', priority: 'high' }],
      }],
    }],
  }
  const edited = (): GoalPlanProposal => ({
    ...original,
    goal: { ...original.goal, title: 'Ship Kobi v2' },
    projects: [{
      ...original.projects[0]!,
      milestones: [{
        ...original.projects[0]!.milestones[0]!,
        targetDate: '2026-04-15',
        tasks: [{ title: 'Deploy the app', dueDate: '2026-02-01', priority: 'low' }],
      }],
    }],
  })
  const statusOf = () => db.select({ status: aiProposals.status }).from(aiProposals)
    .where(eq(aiProposals.id, proposalId)).get()?.status
  const rows = () => ({
    goals: db.select().from(goals).where(eq(goals.userId, userId)).all(),
    projects: db.select().from(projects).where(eq(projects.userId, userId)).all(),
    milestones: db.select().from(milestones).where(eq(milestones.userId, userId)).all(),
    tasks: db.select().from(tasks).where(eq(tasks.userId, userId)).all(),
  })

  beforeEach(() => {
    vi.stubGlobal('createError', ({ statusText }: { statusText: string }) => new Error(statusText))
    sqlite = new Database(':memory:')
    db = initializeDatabase(sqlite)
    db.insert(users).values({
      id: userId,
      email: 'edit@example.test',
      name: 'Edit',
      passwordHash: 'test-hash',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }).run()
    createWorkspaceForUser(db, userId)
    db.insert(aiProposals).values({
      id: proposalId,
      userId,
      workspaceId,
      kind: 'goal_plan',
      payloadJson: JSON.stringify(original),
      status: 'pending',
      createdAt: '2026-01-01T00:00:00.000Z',
    }).run()
  })

  afterEach(() => {
    sqlite.close()
    vi.unstubAllGlobals()
  })

  it('persists the edited values, not the stored payload', () => {
    acceptProposal(db, userId, workspaceId, proposalId, { plan: edited() })

    const saved = rows()
    expect(saved.goals.map(row => row.title)).toEqual(['Ship Kobi v2'])
    expect(saved.milestones.map(row => row.targetDate)).toEqual(['2026-04-15'])
    expect(saved.tasks.map(row => row.priority)).toEqual(['low'])
  })

  it('leaves payloadJson untouched and marks the proposal accepted', () => {
    const before = db.select({ payload: aiProposals.payloadJson }).from(aiProposals)
      .where(eq(aiProposals.id, proposalId)).get()?.payload

    acceptProposal(db, userId, workspaceId, proposalId, { plan: edited() })

    const after = db.select({ payload: aiProposals.payloadJson }).from(aiProposals)
      .where(eq(aiProposals.id, proposalId)).get()?.payload
    expect(after).toBe(before)
    expect(JSON.parse(after!)).toEqual(original)
    expect(statusOf()).toBe('accepted')
  })

  it('persists cleared dates as null without throwing', () => {
    const plan = edited()
    plan.goal.targetDate = null
    plan.projects[0]!.milestones[0]!.targetDate = null
    plan.projects[0]!.milestones[0]!.tasks[0]!.dueDate = null
    expect(goalPlanProposalSchema.safeParse(plan).success).toBe(true)

    expect(() => acceptProposal(db, userId, workspaceId, proposalId, { plan })).not.toThrow()

    const saved = rows()
    expect(saved.goals[0]?.targetDate).toBeNull()
    expect(saved.milestones[0]?.targetDate).toBeNull()
    expect(saved.tasks[0]?.dueDate).toBeNull()
    expect(statusOf()).toBe('accepted')
  })

  it('rolls back and keeps the proposal pending when the plan fails mid-accept, so a corrected retry succeeds', () => {
    const bad = edited()
    // Bypasses the handler's validation to exercise the service transaction directly.
    bad.projects[0]!.milestones[0]!.tasks[0]!.priority = 'urgent' as never

    expect(() => acceptProposal(db, userId, workspaceId, proposalId, { plan: bad })).toThrow()

    expect(statusOf()).toBe('pending')
    const after = rows()
    expect(after.goals).toHaveLength(0)
    expect(after.projects).toHaveLength(0)
    expect(after.milestones).toHaveLength(0)
    expect(after.tasks).toHaveLength(0)

    acceptProposal(db, userId, workspaceId, proposalId, { plan: edited() })
    expect(statusOf()).toBe('accepted')
    expect(rows().goals).toHaveLength(1)
  })

  it('still returns not found for an edited plan on another workspace\'s proposal', () => {
    const otherWorkspace = `workspace-other-${userId}`
    const now = '2026-01-01T00:00:00.000Z'
    db.insert(workspaces).values({ id: otherWorkspace, name: 'Other', ownerId: userId, createdAt: now, updatedAt: now }).run()
    db.insert(workspaceMembers).values({ workspaceId: otherWorkspace, userId, role: 'owner', joinedAt: now }).run()
    db.insert(aiProposals).values({
      id: 'proposal-other-edit',
      userId,
      workspaceId: otherWorkspace,
      kind: 'goal_plan',
      payloadJson: JSON.stringify(original),
      status: 'pending',
      createdAt: now,
    }).run()

    expect(() => acceptProposal(db, userId, workspaceId, 'proposal-other-edit', { plan: edited() })).toThrowError('Proposal not found')
    expect(rows().goals).toHaveLength(0)
    expect(db.select({ status: aiProposals.status }).from(aiProposals)
      .where(eq(aiProposals.id, 'proposal-other-edit')).get()?.status).toBe('pending')
  })
})

describe('Ask Kobi reply source', () => {
  let sqlite: Database.Database
  let db: KobiDatabase
  const userId = '44444444-4444-4444-8444-444444444444'

  beforeEach(() => {
    sqlite = new Database(':memory:')
    db = initializeDatabase(sqlite)
    db.insert(users).values({
      id: userId,
      email: 'offline@example.test',
      name: 'Offline',
      passwordHash: 'test-hash',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }).run()
    createWorkspaceForUser(db, userId)
  })

  afterEach(() => sqlite.close())

  const offlineConfig = { apiKey: '', baseUrl: 'https://openrouter.ai/api/v1', model: 'a' }

  it('marks an unconfigured provider as offline and says so in the reply', async () => {
    const reply = await askKobi(db, userId, { message: 'hello' }, offlineConfig)

    expect(reply.source).toBe('offline')
    expect(reply.message).toContain(OFFLINE_NOTICE)
  })

  it('persists the offline notice into stored history', async () => {
    await askKobi(db, userId, { message: 'hello' }, offlineConfig)

    const stored = db.select({ role: aiMessages.role, content: aiMessages.content })
      .from(aiMessages).where(eq(aiMessages.userId, userId)).all()
    expect(stored.find(row => row.role === 'assistant')?.content).toContain(OFFLINE_NOTICE)
  })

  it('still stores a valid proposal for an over-long offline goal plan', async () => {
    const message = `I want to ${'do a great many different things '.repeat(20)}`

    const reply = await askKobi(db, userId, { message }, offlineConfig)

    expect(reply.source).toBe('offline')
    expect(reply.proposalId).not.toBeNull()
    const row = db.select({ payload: aiProposals.payloadJson }).from(aiProposals)
      .where(eq(aiProposals.id, reply.proposalId!)).get()
    expect(goalPlanProposalSchema.parse(JSON.parse(row!.payload)).goal.title.length)
      .toBeLessThanOrEqual(MAX_TITLE_LENGTH)
  })
})

describe('Ask Kobi provider outcomes (stubbed provider)', () => {
  let sqlite: Database.Database
  let db: KobiDatabase
  let warn: ReturnType<typeof vi.spyOn>
  let seq = 0
  const apiKey = 'sk-test-secret-key-do-not-leak'
  const config = { apiKey, baseUrl: 'https://provider.invalid/api/v1', model: 'a' }

  // The rate limiter is module-level, so every test gets its own user.
  const newUser = () => {
    seq += 1
    const id = `55555555-5555-4555-8555-${String(seq).padStart(12, '0')}`
    db.insert(users).values({
      id,
      email: `stub${seq}@example.test`,
      name: 'Stub',
      passwordHash: 'test-hash',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }).run()
    createWorkspaceForUser(db, id)
    return id
  }

  const completion = (content: unknown) => ({
    choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }],
  })

  const proposalRows = (id: string) => db.select({ id: aiProposals.id }).from(aiProposals).where(eq(aiProposals.userId, id)).all()
  const warnText = () => JSON.stringify(warn.mock.calls)

  beforeEach(() => {
    sqlite = new Database(':memory:')
    db = initializeDatabase(sqlite)
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
    vi.unstubAllGlobals()
    sqlite.close()
  })

  it('treats a clarifying question as a model reply, not an outage', async () => {
    const userId = newUser()
    const question = 'What would you like to achieve?'
    const fetchStub = vi.fn().mockResolvedValue(completion({ message: question, proposal: null }))
    vi.stubGlobal('$fetch', fetchStub)

    const reply = await askKobi(db, userId, { message: 'hello' }, config)

    // Proves the stub path ran: the provider was called exactly once.
    expect(fetchStub).toHaveBeenCalledTimes(1)
    expect(reply.source).toBe('model')
    expect(reply.proposal).toBeNull()
    expect(reply.proposalId).toBeNull()
    expect(reply.message).toBe(question)
    expect(reply.message).not.toContain(OFFLINE_NOTICE)
    const assistant = db.select({ role: aiMessages.role, content: aiMessages.content })
      .from(aiMessages).where(eq(aiMessages.userId, userId)).all().find(row => row.role === 'assistant')
    expect(assistant?.content).toBe(question)
    expect(proposalRows(userId)).toHaveLength(0)
    expect(warn).not.toHaveBeenCalled()
  })

  it('falls back to the offline planner on an HTTP failure and logs status and body', async () => {
    const userId = newUser()
    const message = 'I want to learn basketball'
    vi.stubGlobal('$fetch', vi.fn().mockRejectedValue(Object.assign(new Error('402 Payment Required'), {
      status: 402,
      data: { error: { message: 'Insufficient credits' } },
    })))

    const reply = await askKobi(db, userId, { message }, config)

    expect(reply.source).toBe('offline')
    expect(reply.message.startsWith(OFFLINE_NOTICE)).toBe(true)
    expect(reply.proposal).toEqual(localPlan(message))
    expect(reply.proposalId).not.toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    const record = warn.mock.calls[0]?.[1] as { status: number, body: string, reason: string }
    expect(record.status).toBe(402)
    expect(record.body).toContain('Insufficient credits')
    expect(record.reason).toBe('provider_unreachable')
    expect(warnText()).not.toContain(apiKey)
    expect(warnText()).not.toContain('Authorization')
  })

  it('truncates a large provider error body to 500 characters in the log', async () => {
    const userId = newUser()
    vi.stubGlobal('$fetch', vi.fn().mockRejectedValue(Object.assign(new Error('500 Server Error'), {
      status: 500,
      data: 'z'.repeat(5000),
    })))

    await askKobi(db, userId, { message: 'hi' }, config)

    const record = warn.mock.calls[0]?.[1] as { body: string }
    expect(record.body).toHaveLength(500)
  })

  it('reports a transport failure without a status as offline', async () => {
    const userId = newUser()
    vi.stubGlobal('$fetch', vi.fn().mockRejectedValue(new Error('fetch failed')))

    const reply = await askKobi(db, userId, { message: 'hi' }, config)

    expect(reply.source).toBe('offline')
    expect(reply.message.startsWith(OFFLINE_NOTICE)).toBe(true)
    const record = warn.mock.calls[0]?.[1] as { status?: number }
    expect(record.status).toBeUndefined()
  })

  // A plan larger than Kobi stores is trimmed to the bounds, not discarded: the
  // user keeps a usable plan instead of an apology they cannot act on.
  it('clamps an oversize plan to the bounds and still drafts a proposal', async () => {
    const userId = newUser()
    const oversize = {
      message: 'Here is your plan.',
      proposal: {
        kind: 'goal_plan',
        goal: { title: 'Become an AI engineer', description: '', targetDate: null },
        projects: Array.from({ length: PLAN_BOUNDS.projects + 3 }, (_, index) => ({
          title: index === 0 ? 'x'.repeat(MAX_TITLE_LENGTH + 1) : `Area ${index + 1}`,
          description: '',
          milestones: [{ title: 'M', targetDate: null, tasks: [{ title: 'T', dueDate: null, priority: 'high' }] }],
        })),
      },
    }
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(completion(oversize)))

    const reply = await askKobi(db, userId, { message: 'Help me become an AI engineer' }, config)

    expect(reply.source).toBe('model')
    expect(reply.message).not.toBe(INVALID_REPLY_NOTICE)
    expect(reply.proposal?.projects).toHaveLength(PLAN_BOUNDS.projects)
    expect(reply.proposal?.projects[0]?.title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH)
    expect(reply.proposalId).not.toBeNull()
    expect(proposalRows(userId)).toHaveLength(1)
  })

  it('reports a malformed plan as an invalid reply with no offline prefix and no proposal', async () => {
    const userId = newUser()
    const overlong = {
      message: 'Here is your plan.',
      proposal: {
        kind: 'goal_plan',
        goal: { title: 'Ship the thing', description: '', targetDate: '2026-Q1' },
        projects: [{
          title: 'P',
          description: '',
          milestones: [{ title: 'M', targetDate: null, tasks: [{ title: 'T', dueDate: null, priority: 'high' }] }],
        }],
      },
    }
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(completion(overlong)))

    const reply = await askKobi(db, userId, { message: 'I want to do a thing' }, config)

    expect(reply.source).toBe('invalid')
    expect(reply.message).toBe(INVALID_REPLY_NOTICE)
    expect(reply.message).not.toContain(OFFLINE_NOTICE)
    expect(reply.proposal).toBeNull()
    expect(reply.proposalId).toBeNull()
    expect(proposalRows(userId)).toHaveLength(0)
    const record = warn.mock.calls[0]?.[1] as { reason: string, status?: number }
    expect(record.reason).toBe('reply_contract')
    expect(record.status).toBeUndefined()
    expect(warnText()).not.toContain(apiKey)
    expect(warnText()).not.toContain('Authorization')
  })

  it('reports non-JSON model content as an invalid reply', async () => {
    const userId = newUser()
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(completion('Sure! Happy to help.')))

    const reply = await askKobi(db, userId, { message: 'hello' }, config)

    expect(reply.source).toBe('invalid')
    expect(reply.message).toBe(INVALID_REPLY_NOTICE)
  })

  it('accepts a model reply with a proposal and one without', async () => {
    const userId = newUser()
    const plan = localPlan('I want to learn basketball')
    const stub = vi.fn()
      .mockResolvedValueOnce(completion({ message: 'Plan.', proposal: plan }))
      .mockResolvedValueOnce(completion({ message: 'Just an answer.', proposal: null }))
    vi.stubGlobal('$fetch', stub)

    const withPlan = await askKobi(db, userId, { message: 'hello' }, config)
    const withoutPlan = await askKobi(db, userId, { message: 'hello again' }, config)

    expect(withPlan.source).toBe('model')
    expect(withPlan.proposalId).not.toBeNull()
    expect(withoutPlan.source).toBe('model')
    expect(withoutPlan.proposal).toBeNull()
    expect(proposalRows(userId)).toHaveLength(1)
  })

  it('treats an unusable provider envelope as offline', async () => {
    const userId = newUser()
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ choices: [] }))

    const reply = await askKobi(db, userId, { message: 'hello' }, config)

    expect(reply.source).toBe('offline')
  })

  it('stores a valid model plan as a pending proposal', async () => {
    const userId = newUser()
    const plan = localPlan('I want to learn basketball')
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(completion({ message: 'Plan ready.', proposal: plan })))

    const reply = await askKobi(db, userId, { message: 'I want to learn basketball' }, config)

    expect(reply.source).toBe('model')
    expect(reply.proposalId).not.toBeNull()
    expect(proposalRows(userId)).toHaveLength(1)
  })
})
