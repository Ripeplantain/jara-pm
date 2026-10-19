import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { aiMessages, aiProposals, goals, projects, tasks, users } from '../server/db/schema'
import type { KobiDatabase } from '../server/db'
import { acceptProposal, askKobi, INVALID_REPLY_NOTICE, localPlan, OFFLINE_NOTICE } from '../server/services/ai'
import { goalPlanProposalSchema } from '../shared/schemas/ai'
import { MAX_TITLE_LENGTH } from '../shared/schemas/common'
import { initializeDatabase } from '../server/utils/database'

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
    db.insert(aiProposals).values({
      id: proposalId,
      userId,
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
  })

  afterEach(() => sqlite.close())

  const offlineConfig = { apiKey: '', baseUrl: 'https://openrouter.ai/api/v1', chatModel: 'a', planModel: 'b' }

  it('marks an unconfigured provider as offline and says so in the reply', async () => {
    const reply = await askKobi(db, userId, { message: 'hello', mode: 'chat' }, offlineConfig)

    expect(reply.source).toBe('offline')
    expect(reply.message).toContain(OFFLINE_NOTICE)
  })

  it('persists the offline notice into stored history', async () => {
    await askKobi(db, userId, { message: 'hello', mode: 'chat' }, offlineConfig)

    const stored = db.select({ role: aiMessages.role, content: aiMessages.content })
      .from(aiMessages).where(eq(aiMessages.userId, userId)).all()
    expect(stored.find(row => row.role === 'assistant')?.content).toContain(OFFLINE_NOTICE)
  })

  it('still stores a valid proposal for an over-long offline goal plan', async () => {
    const message = `I want to ${'do a great many different things '.repeat(20)}`

    const reply = await askKobi(db, userId, { message, mode: 'goal_plan' }, offlineConfig)

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
  const config = { apiKey, baseUrl: 'https://provider.invalid/api/v1', chatModel: 'a', planModel: 'b' }

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

  it('treats a clarifying question in plan mode as a model reply, not an outage', async () => {
    const userId = newUser()
    const question = 'What would you like to achieve?'
    const fetchStub = vi.fn().mockResolvedValue(completion({ message: question, proposal: null }))
    vi.stubGlobal('$fetch', fetchStub)

    const reply = await askKobi(db, userId, { message: 'hello', mode: 'goal_plan' }, config)

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

    const reply = await askKobi(db, userId, { message, mode: 'goal_plan' }, config)

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

    await askKobi(db, userId, { message: 'hi', mode: 'chat' }, config)

    const record = warn.mock.calls[0]?.[1] as { body: string }
    expect(record.body).toHaveLength(500)
  })

  it('reports a transport failure without a status as offline', async () => {
    const userId = newUser()
    vi.stubGlobal('$fetch', vi.fn().mockRejectedValue(new Error('fetch failed')))

    const reply = await askKobi(db, userId, { message: 'hi', mode: 'chat' }, config)

    expect(reply.source).toBe('offline')
    expect(reply.message.startsWith(OFFLINE_NOTICE)).toBe(true)
    const record = warn.mock.calls[0]?.[1] as { status?: number }
    expect(record.status).toBeUndefined()
  })

  it('reports a bound-violating plan as an invalid reply with no offline prefix and no proposal', async () => {
    const userId = newUser()
    const overlong = {
      message: 'Here is your plan.',
      proposal: {
        kind: 'goal_plan',
        goal: { title: 'x'.repeat(MAX_TITLE_LENGTH + 1), description: '', targetDate: null },
        projects: [{
          title: 'P',
          description: '',
          milestones: [{ title: 'M', targetDate: null, tasks: [{ title: 'T', dueDate: null, priority: 'high' }] }],
        }],
      },
    }
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(completion(overlong)))

    const reply = await askKobi(db, userId, { message: 'I want to do a thing', mode: 'goal_plan' }, config)

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

    const reply = await askKobi(db, userId, { message: 'hello', mode: 'goal_plan' }, config)

    expect(reply.source).toBe('invalid')
    expect(reply.message).toBe(INVALID_REPLY_NOTICE)
  })

  it('reports a proposal returned in chat mode as an invalid reply', async () => {
    const userId = newUser()
    const plan = localPlan('I want to learn basketball')
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(completion({ message: 'Plan.', proposal: plan })))

    const reply = await askKobi(db, userId, { message: 'hello', mode: 'chat' }, config)

    expect(reply.source).toBe('invalid')
    expect(reply.proposalId).toBeNull()
    expect(proposalRows(userId)).toHaveLength(0)
  })

  it('treats an unusable provider envelope as offline', async () => {
    const userId = newUser()
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ choices: [] }))

    const reply = await askKobi(db, userId, { message: 'hello', mode: 'chat' }, config)

    expect(reply.source).toBe('offline')
  })

  it('stores a valid model plan as a pending proposal', async () => {
    const userId = newUser()
    const plan = localPlan('I want to learn basketball')
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(completion({ message: 'Plan ready.', proposal: plan })))

    const reply = await askKobi(db, userId, { message: 'I want to learn basketball', mode: 'goal_plan' }, config)

    expect(reply.source).toBe('model')
    expect(reply.proposalId).not.toBeNull()
    expect(proposalRows(userId)).toHaveLength(1)
  })
})
