import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { KobiDatabase } from '../server/db'
import { users } from '../server/db/schema'
import { createTask, listTasks, updateTask } from '../server/services/tasks'
import { initializeDatabase } from '../server/utils/database'

describe('task service', () => {
  let sqlite: Database.Database
  let db: KobiDatabase

  beforeEach(() => {
    sqlite = new Database(':memory:')
    db = initializeDatabase(sqlite)
    const now = new Date().toISOString()
    db.insert(users).values([
      {
        id: '11111111-1111-4111-8111-111111111111',
        email: 'one@example.test',
        name: 'One',
        passwordHash: 'test-hash',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        email: 'two@example.test',
        name: 'Two',
        passwordHash: 'test-hash',
        createdAt: now,
        updatedAt: now,
      },
    ]).run()
  })

  afterEach(() => sqlite.close())

  it('isolates every task list by the authenticated user', () => {
    createTask(db, '11111111-1111-4111-8111-111111111111', {
      title: 'Private to one', description: '', status: 'todo', priority: 'none',
      dueDate: null, scheduledFor: null, selectedForToday: false,
      projectId: null, milestoneId: null, parentId: null,
    })
    createTask(db, '22222222-2222-4222-8222-222222222222', {
      title: 'Private to two', description: '', status: 'todo', priority: 'none',
      dueDate: null, scheduledFor: null, selectedForToday: false,
      projectId: null, milestoneId: null, parentId: null,
    })

    expect(listTasks(db, '11111111-1111-4111-8111-111111111111', { scope: 'all' }).map(task => task.title))
      .toEqual(['Private to one'])
  })

  it('completes a task without changing omitted fields', () => {
    const task = createTask(db, '11111111-1111-4111-8111-111111111111', {
      title: 'Keep my fields', description: '', status: 'todo', priority: 'high',
      dueDate: null, scheduledFor: null, selectedForToday: true,
      projectId: null, milestoneId: null, parentId: null,
    })
    const updated = updateTask(db, '11111111-1111-4111-8111-111111111111', task.id, { status: 'done' })

    expect(updated.priority).toBe('high')
    expect(updated.selectedForToday).toBe(true)
    expect(updated.completedAt).not.toBeNull()
  })
})
