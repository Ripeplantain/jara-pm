import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { aiProposals, goals, projects, tasks, users } from '../server/db/schema'
import type { KobiDatabase } from '../server/db'
import { acceptProposal } from '../server/services/ai'
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
