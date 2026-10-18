import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { aiMessages, aiProposals, goals, projects, tasks, users } from '../server/db/schema'
import type { KobiDatabase } from '../server/db'
import { acceptProposal, askKobi, OFFLINE_NOTICE } from '../server/services/ai'
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
