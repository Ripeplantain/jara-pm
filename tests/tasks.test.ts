import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTask, listTasks, updateTask } from '../server/services/tasks'
import { initializeDatabase } from '../server/utils/database'

describe('task service', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    initializeDatabase(db)
    const now = new Date().toISOString()
    const insertUser = db.prepare(`
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at)
      VALUES (?, ?, ?, 'test-hash', ?, ?)
    `)
    insertUser.run('11111111-1111-4111-8111-111111111111', 'one@example.test', 'One', now, now)
    insertUser.run('22222222-2222-4222-8222-222222222222', 'two@example.test', 'Two', now, now)
  })

  afterEach(() => db.close())

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
