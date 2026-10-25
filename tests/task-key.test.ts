import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { KobiDatabase } from '../server/db'
import { users, workspaces } from '../server/db/schema'
import { createTask, getTaskByKey } from '../server/services/tasks'
import { initializeDatabase } from '../server/utils/database'
import {
  deriveWorkspaceKey,
  extractTaskKeys,
  formatTaskKey,
  parseTaskKey,
  splitTaskKeyMentions,
} from '../shared/utils/task-key'
import { createWorkspaceForUser } from './workspace-fixtures'

const taskInput = (title: string) => ({
  title,
  description: '',
  status: 'todo' as const,
  priority: 'none' as const,
  dueDate: null,
  scheduledFor: null,
  recurrence: 'none' as const,
  selectedForToday: false,
  projectId: null,
  milestoneId: null,
  parentId: null,
})

describe('workspace key derivation', () => {
  it('derives a key from the name and suffixes collisions', () => {
    expect(deriveWorkspaceKey('Acme')).toBe('ACME')
    expect(deriveWorkspaceKey('Acme', ['ACME'])).toBe('ACME2')
    expect(deriveWorkspaceKey('Engineering', [])).toBe('ENGIN')
    expect(deriveWorkspaceKey('Engineering', ['ENGIN'])).toBe('ENGI2')
  })

  it('falls back to W when the name does not start with a letter', () => {
    expect(deriveWorkspaceKey('9 Lives')).toBe('W')
    expect(deriveWorkspaceKey('  ')).toBe('W')
    expect(deriveWorkspaceKey('9 Lives', ['W'])).toBe('W2')
  })

  it('always produces a key the database CHECK accepts', () => {
    const taken: string[] = []
    for (let index = 0; index < 60; index += 1) {
      const key = deriveWorkspaceKey('Acme', taken)
      expect(key).toMatch(/^[A-Z][A-Z0-9]{0,4}$/)
      expect(taken).not.toContain(key)
      taken.push(key)
    }
  })
})

describe('task key formatting', () => {
  it('round-trips through format and parse', () => {
    expect(formatTaskKey('K', 128)).toBe('K-128')
    expect(parseTaskKey('K-128')).toEqual({ workspaceKey: 'K', taskNumber: 128 })
    expect(parseTaskKey(' ACME-7 ')).toEqual({ workspaceKey: 'ACME', taskNumber: 7 })
  })

  it('rejects malformed keys rather than guessing', () => {
    for (const value of ['K-', '-1', 'k-1', 'K-0', 'K-01', 'TOOLONG-1', 'K 1', '']) {
      expect(parseTaskKey(value)).toBeNull()
    }
  })

  it('extracts mentioned keys without duplicates', () => {
    expect(extractTaskKeys('fixes K-12 and K-12 and K-13')).toEqual(['K-12', 'K-13'])
    expect(extractTaskKeys('nothing here')).toEqual([])
    // Re-reading the same text must stay stable; Slice D1 relies on this being idempotent.
    const text = 'blocks ACME-3, relates to K-9'
    expect(extractTaskKeys(text)).toEqual(extractTaskKeys(text))
  })
})

describe('task key autolinking', () => {
  it('splits mentions out of surrounding text losslessly', () => {
    const text = 'blocked by K-12, see also ACME-3.'
    const segments = splitTaskKeyMentions(text)

    expect(segments.map(segment => segment.text).join('')).toBe(text)
    expect(segments.filter(segment => segment.key).map(segment => segment.key)).toEqual(['K-12', 'ACME-3'])
  })

  it('leaves text with no mentions as a single plain segment', () => {
    expect(splitTaskKeyMentions('nothing to link')).toEqual([{ text: 'nothing to link', key: null }])
    expect(splitTaskKeyMentions('')).toEqual([])
  })

  it('does not link something that only looks like a key', () => {
    for (const text of ['covid-19', 'k-12', 'TOOLONG-1', 'K-0']) {
      expect(splitTaskKeyMentions(text).every(segment => segment.key === null), text).toBe(true)
    }
  })

  it('keeps adjacent mentions separate', () => {
    expect(splitTaskKeyMentions('K-1 K-2').filter(segment => segment.key).map(segment => segment.key))
      .toEqual(['K-1', 'K-2'])
  })

  it('is stable across repeated calls', () => {
    // The module-level mention pattern is global; a shared lastIndex would make the second
    // call return different segments from the first.
    const text = 'K-1 and K-2'
    expect(splitTaskKeyMentions(text)).toEqual(splitTaskKeyMentions(text))
    expect(extractTaskKeys(text)).toEqual(extractTaskKeys(text))
  })
})

describe('task number allocation', () => {
  let sqlite: Database.Database
  let db: KobiDatabase
  let workspaceId: string
  let otherWorkspaceId: string

  const userOne = '11111111-1111-4111-8111-111111111111'
  const userTwo = '22222222-2222-4222-8222-222222222222'

  beforeEach(() => {
    sqlite = new Database(':memory:')
    db = initializeDatabase(sqlite)
    const now = '2026-01-01T00:00:00.000Z'
    db.insert(users).values([
      { id: userOne, email: 'one@example.test', name: 'One', passwordHash: 'h', createdAt: now, updatedAt: now },
      { id: userTwo, email: 'two@example.test', name: 'Two', passwordHash: 'h', createdAt: now, updatedAt: now },
    ]).run()
    workspaceId = createWorkspaceForUser(db, userOne)
    otherWorkspaceId = createWorkspaceForUser(db, userTwo)
  })

  afterEach(() => sqlite.close())

  it('gives fifty tasks created in a loop fifty consecutive numbers', () => {
    const numbers: number[] = []
    for (let index = 0; index < 50; index += 1) {
      numbers.push(createTask(db, userOne, workspaceId, taskInput(`Task ${index}`)).number)
    }
    expect(numbers).toEqual(Array.from({ length: 50 }, (_, index) => index + 1))
    expect(new Set(numbers).size).toBe(50)
    expect(db.select({ counter: workspaces.taskCounter }).from(workspaces).where(eq(workspaces.id, workspaceId)).get())
      .toEqual({ counter: 50 })
  })

  it('numbers tasks per workspace, so both workspaces start at one', () => {
    expect(createTask(db, userOne, workspaceId, taskInput('First here')).number).toBe(1)
    expect(createTask(db, userTwo, otherWorkspaceId, taskInput('First there')).number).toBe(1)
    expect(createTask(db, userOne, workspaceId, taskInput('Second here')).number).toBe(2)
  })

  it('leaves the counter unchanged when the insert fails', () => {
    createTask(db, userOne, workspaceId, taskInput('Real task'))
    expect(() => createTask(db, userOne, workspaceId, {
      ...taskInput('Doomed task'),
      projectId: '33333333-3333-4333-8333-333333333333',
    })).toThrow()
    expect(db.select({ counter: workspaces.taskCounter }).from(workspaces).where(eq(workspaces.id, workspaceId)).get())
      .toEqual({ counter: 1 })
    expect(createTask(db, userOne, workspaceId, taskInput('Next task')).number).toBe(2)
  })

  it('resolves a task by its display key', () => {
    const task = createTask(db, userOne, workspaceId, taskInput('Findable'))
    const key = db.select({ key: workspaces.key }).from(workspaces).where(eq(workspaces.id, workspaceId)).get()?.key

    expect(key).toBeTruthy()
    expect(getTaskByKey(db, userOne, workspaceId, `${key}-1`).id).toBe(task.id)
    // Keys are typed by hand, so surrounding whitespace is tolerated.
    expect(getTaskByKey(db, userOne, workspaceId, ` ${key}-1 `).id).toBe(task.id)
  })

  it('reports an unknown or malformed key as missing rather than failing', () => {
    const key = db.select({ key: workspaces.key }).from(workspaces).where(eq(workspaces.id, workspaceId)).get()?.key
    createTask(db, userOne, workspaceId, taskInput('Only one'))

    for (const candidate of [`${key}-999`, 'ZZZZZ-1', 'not-a-key', `${key}-0`, '', '---']) {
      expect(() => getTaskByKey(db, userOne, workspaceId, candidate), candidate)
        .toThrowError(expect.objectContaining({ statusCode: 404 }))
    }
  })

  it('does not resolve a key belonging to another workspace', () => {
    createTask(db, userOne, workspaceId, taskInput('Mine'))
    const theirs = createTask(db, userTwo, otherWorkspaceId, taskInput('Theirs'))
    const theirKey = db.select({ key: workspaces.key })
      .from(workspaces).where(eq(workspaces.id, otherWorkspaceId)).get()?.key

    // The number exists in the caller's workspace too, so this only passes if the key prefix
    // is matched as well -- the lookup must not fall through to "number 1 in my workspace".
    expect(getTaskByKey(db, userTwo, otherWorkspaceId, `${theirKey}-1`).id).toBe(theirs.id)
    expect(() => getTaskByKey(db, userOne, workspaceId, `${theirKey}-1`))
      .toThrowError(expect.objectContaining({ statusCode: 404 }))
  })

  it('does not leak numbers across workspaces', () => {
    createTask(db, userOne, workspaceId, taskInput('Here'))
    const other = createTask(db, userTwo, otherWorkspaceId, taskInput('There'))
    expect(other.number).toBe(1)
    expect(db.select({ counter: workspaces.taskCounter }).from(workspaces).where(eq(workspaces.id, workspaceId)).get())
      .toEqual({ counter: 1 })
  })
})
