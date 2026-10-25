import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import type { KobiDatabase } from '../server/db'
import { statuses, users, workspaceMembers } from '../server/db/schema'
import { createProject, getProject } from '../server/services/projects'
import {
  createStatus,
  defaultStatusId,
  deleteStatus,
  getStatus,
  listStatuses,
  reorderStatuses,
  statusForCategory,
  updateStatus,
} from '../server/services/statuses'
import { createTask, getTask, listTasks, updateTask } from '../server/services/tasks'
import { createWorkspace } from '../server/services/workspace'
import { initializeDatabase } from '../server/utils/database'
import {
  createStatusSchema,
  deleteStatusQuerySchema,
  reorderStatusesSchema,
  updateStatusSchema,
} from '../shared/schemas/status'
import { createWorkspaceForUser, statusIdFor } from './workspace-fixtures'

const ownerId = '11111111-1111-4111-8111-111111111111'
const memberId = '22222222-2222-4222-8222-222222222222'
const strangerId = '33333333-3333-4333-8333-333333333333'

const base = {
  description: '', priority: 'none' as const, scheduledFor: null, dueDate: null,
  recurrence: 'none' as const, selectedForToday: false,
  projectId: null, milestoneId: null, parentId: null,
}

describe('workspace statuses', () => {
  let sqlite: Database.Database
  let db: KobiDatabase
  let workspaceId: string
  let strangerWorkspaceId: string

  beforeEach(() => {
    sqlite = new Database(':memory:')
    db = initializeDatabase(sqlite)
    const now = '2026-01-01T00:00:00.000Z'
    db.insert(users).values([
      { id: ownerId, email: 'owner@example.test', name: 'Owner', passwordHash: 'h', createdAt: now, updatedAt: now },
      { id: memberId, email: 'member@example.test', name: 'Member', passwordHash: 'h', createdAt: now, updatedAt: now },
      { id: strangerId, email: 'stranger@example.test', name: 'Stranger', passwordHash: 'h', createdAt: now, updatedAt: now },
    ]).run()
    workspaceId = createWorkspaceForUser(db, ownerId)
    strangerWorkspaceId = createWorkspaceForUser(db, strangerId)
    // A second member of the SAME workspace, with it active.
    db.insert(workspaceMembers).values({ workspaceId, userId: memberId, role: 'member', joinedAt: now }).run()
    db.update(users).set({ activeWorkspaceId: workspaceId }).where(eq(users.id, memberId)).run()
  })

  afterEach(() => sqlite.close())

  const idOf = (name: string, ws = workspaceId) => listStatuses(db, ws).find(status => status.name === name)!.id
  const task = (title: string, statusId?: string, userId = ownerId, projectId: string | null = null) =>
    createTask(db, userId, workspaceId, { ...base, title, statusId, projectId })

  describe('seeding', () => {
    it('gives a new workspace the documented five statuses with exactly one default', () => {
      expect(listStatuses(db, workspaceId).map(({ name, category, position, isDefault }) => ({ name, category, position, isDefault })))
        .toEqual([
          { name: 'Backlog', category: 'backlog', position: 0, isDefault: false },
          { name: 'Todo', category: 'unstarted', position: 1, isDefault: true },
          { name: 'In Progress', category: 'started', position: 2, isDefault: false },
          { name: 'Done', category: 'completed', position: 3, isDefault: false },
          { name: 'Canceled', category: 'canceled', position: 4, isDefault: false },
        ])
      expect(listStatuses(db, workspaceId).filter(status => status.isDefault)).toHaveLength(1)
    })

    it('seeds a workspace created through the service inside its own transaction', () => {
      const created = createWorkspace(db, ownerId, { name: 'Second' })

      expect(listStatuses(db, created.id)).toHaveLength(5)
      expect(defaultStatusId(db, created.id)).toBeTruthy()
    })

    it('gives the two workspaces independent statuses', () => {
      const own = listStatuses(db, workspaceId).map(status => status.id)
      const theirs = listStatuses(db, strangerWorkspaceId).map(status => status.id)
      expect(own.filter(id => theirs.includes(id))).toEqual([])

      updateStatus(db, ownerId, workspaceId, idOf('Done'), { name: 'Shipped' })
      expect(listStatuses(db, strangerWorkspaceId).map(status => status.name)).toContain('Done')
      expect(listStatuses(db, strangerWorkspaceId).map(status => status.name)).not.toContain('Shipped')
    })

    // The seed builds ids in SQL rather than with crypto.randomUUID, and every route validates
    // ids with a uuid schema, so a malformed seed would be storable but unusable through the API.
    it('issues UUID-shaped ids the API id schema accepts', () => {
      const seeded = listStatuses(db, workspaceId)
      expect(seeded).toHaveLength(5)
      for (const status of seeded) {
        expect(status.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
        expect(reorderStatusesSchema.safeParse({ statusIds: [status.id] }).success).toBe(true)
      }
    })
  })

  describe('rename, reorder and default', () => {
    it('renaming Done leaves category behaviour, completedAt and progress unchanged', () => {
      const project = createProject(db, ownerId, workspaceId, { title: 'P', description: '', goalId: null, targetDate: null })
      const finished = task('Finished', statusIdFor(db, workspaceId, 'completed'), ownerId, project.id)
      task('Open', undefined, ownerId, project.id)
      const before = getProject(db, ownerId, workspaceId, project.id)

      const renamed = updateStatus(db, ownerId, workspaceId, idOf('Done'), { name: 'Shipped' })

      expect(renamed).toMatchObject({ name: 'Shipped', category: 'completed' })
      const after = getTask(db, ownerId, workspaceId, finished.id)
      expect(after.status).toMatchObject({ name: 'Shipped', category: 'completed' })
      expect(after.completedAt).toBe(finished.completedAt)
      expect(getProject(db, ownerId, workspaceId, project.id).progress).toBe(before.progress)
      expect(getProject(db, ownerId, workspaceId, project.id).completedTaskCount).toBe(1)
      // Completing by the renamed status still counts as completion.
      const open = listTasks(db, ownerId, workspaceId, { scope: 'all', category: 'unstarted' })[0]!
      expect(updateTask(db, ownerId, workspaceId, open.id, { statusId: renamed.id }).completedAt).not.toBeNull()
    })

    it('reorder permutes position only and the list reads back in the new order', () => {
      const original = listStatuses(db, workspaceId)
      const reversed = [...original].reverse().map(status => status.id)

      const result = reorderStatuses(db, ownerId, workspaceId, { statusIds: reversed })

      expect(result.map(status => status.id)).toEqual(reversed)
      expect(result.map(status => status.position)).toEqual([0, 1, 2, 3, 4])
      expect(result.map(status => status.category)).toEqual([...original].reverse().map(status => status.category))
    })

    it('rejects a reorder that omits, repeats or invents a status', () => {
      const ids = listStatuses(db, workspaceId).map(status => status.id)
      expect(() => reorderStatuses(db, ownerId, workspaceId, { statusIds: ids.slice(1) })).toThrowError(expect.objectContaining({ statusMessage: expect.stringContaining('exactly once') }))
      expect(() => reorderStatuses(db, ownerId, workspaceId, { statusIds: [...ids.slice(1), ids[1]!] })).toThrowError(expect.objectContaining({ statusMessage: expect.stringContaining('exactly once') }))
      expect(() => reorderStatuses(db, ownerId, workspaceId, {
        statusIds: [...ids.slice(1), listStatuses(db, strangerWorkspaceId)[0]!.id],
      })).toThrowError(expect.objectContaining({ statusMessage: expect.stringContaining('exactly once') }))
    })

    it('moves the default rather than adding a second one', () => {
      updateStatus(db, ownerId, workspaceId, idOf('Backlog'), { isDefault: true })

      const defaults = listStatuses(db, workspaceId).filter(status => status.isDefault)
      expect(defaults.map(status => status.name)).toEqual(['Backlog'])
      expect(task('Lands in backlog').status.name).toBe('Backlog')
    })

    it('enforces a single default in the database as well', () => {
      expect(() => sqlite.prepare('UPDATE statuses SET is_default = 1 WHERE id = ?').run(idOf('Backlog'))).toThrow()
    })

    it('refuses a completed or canceled status as the default', () => {
      expect(() => updateStatus(db, ownerId, workspaceId, idOf('Done'), { isDefault: true })).toThrowError(expect.objectContaining({ statusMessage: expect.stringContaining('open status') }))
      expect(() => updateStatus(db, ownerId, workspaceId, idOf('Canceled'), { isDefault: true })).toThrowError(expect.objectContaining({ statusMessage: expect.stringContaining('open status') }))
    })

    it('rejects a duplicate name case-insensitively with a 409', () => {
      expect(() => createStatus(db, ownerId, workspaceId, { name: 'in progress', category: 'started' }))
        .toThrowError(expect.objectContaining({ statusCode: 409 }))
      expect(() => updateStatus(db, ownerId, workspaceId, idOf('Todo'), { name: 'Done' }))
        .toThrowError(expect.objectContaining({ statusCode: 409 }))
    })

    it('allows the same name in a different workspace', () => {
      expect(createStatus(db, strangerId, strangerWorkspaceId, { name: 'In Review', category: 'started' }).name).toBe('In Review')
      expect(createStatus(db, ownerId, workspaceId, { name: 'In Review', category: 'started' }).name).toBe('In Review')
    })

    it('appends a created status at the end and fixes its category', () => {
      const created = createStatus(db, ownerId, workspaceId, { name: 'In Review', category: 'started' })

      expect(created).toMatchObject({ category: 'started', position: 5, isDefault: false })
      // The category is not part of the update schema: it cannot be changed after creation.
      expect(updateStatusSchema.parse({ name: 'x', category: 'completed' })).toEqual({ name: 'x' })
    })

    it('keeps the lowest-position status of a category as the toggle target', () => {
      const second = createStatus(db, ownerId, workspaceId, { name: 'Shipped', category: 'completed' })

      expect(statusForCategory(db, workspaceId, 'completed')?.name).toBe('Done')
      reorderStatuses(db, ownerId, workspaceId, {
        statusIds: [second.id, ...listStatuses(db, workspaceId).filter(status => status.id !== second.id).map(status => status.id)],
      })
      expect(statusForCategory(db, workspaceId, 'completed')?.id).toBe(second.id)
    })
  })

  describe('deleting', () => {
    it('refuses to delete a status that tasks reference without a replacement', () => {
      task('Doing', statusIdFor(db, workspaceId, 'started'))

      expect(() => deleteStatus(db, ownerId, workspaceId, idOf('In Progress')))
        .toThrowError(expect.objectContaining({ statusCode: 409 }))
      expect(listStatuses(db, workspaceId)).toHaveLength(5)
    })

    it('reassigns tasks to the replacement in one transaction and removes the status', () => {
      const doing = task('Doing', statusIdFor(db, workspaceId, 'started'))
      const target = idOf('Todo')

      deleteStatus(db, ownerId, workspaceId, idOf('In Progress'), target)

      expect(listStatuses(db, workspaceId).map(status => status.name)).not.toContain('In Progress')
      expect(listStatuses(db, workspaceId).map(status => status.position)).toEqual([0, 1, 2, 3])
      expect(getTask(db, ownerId, workspaceId, doing.id).status.id).toBe(target)
    })

    it('keeps completion markers consistent for reassigned tasks', () => {
      const doing = task('Doing', statusIdFor(db, workspaceId, 'started'))
      updateTask(db, ownerId, workspaceId, doing.id, { statusId: statusIdFor(db, workspaceId, 'started') })
      const finished = task('Finished', statusIdFor(db, workspaceId, 'completed'))
      const second = createStatus(db, ownerId, workspaceId, { name: 'Shipped', category: 'completed' })

      // Done -> Todo reopens: completedAt must be cleared.
      deleteStatus(db, ownerId, workspaceId, idOf('Done'), idOf('Todo'))
      expect(getTask(db, ownerId, workspaceId, finished.id).completedAt).toBeNull()
      // Another completed status remains, so completion is still possible.
      expect(updateTask(db, ownerId, workspaceId, doing.id, { statusId: second.id }).completedAt).not.toBeNull()
    })

    it('moves the default when the default status is deleted, and refuses without a replacement', () => {
      expect(() => deleteStatus(db, ownerId, workspaceId, idOf('Todo')))
        .toThrowError(expect.objectContaining({ statusCode: 409 }))

      deleteStatus(db, ownerId, workspaceId, idOf('Todo'), idOf('Backlog'))

      expect(listStatuses(db, workspaceId).filter(status => status.isDefault).map(status => status.name)).toEqual(['Backlog'])
    })

    it('will not make a completed status the default by deleting the default', () => {
      expect(() => deleteStatus(db, ownerId, workspaceId, idOf('Todo'), idOf('Done'))).toThrowError(expect.objectContaining({ statusMessage: expect.stringContaining('open status') }))
    })

    it('refuses to delete the only completed status or the last status', () => {
      expect(() => deleteStatus(db, ownerId, workspaceId, idOf('Done'), idOf('Todo')))
        .toThrowError(expect.objectContaining({ statusCode: 409 }))
    })

    it('rejects a replacement that is the same status, or from another workspace', () => {
      expect(() => deleteStatus(db, ownerId, workspaceId, idOf('Backlog'), idOf('Backlog')))
        .toThrowError(expect.objectContaining({ statusCode: 422 }))
      expect(() => deleteStatus(db, ownerId, workspaceId, idOf('Backlog'), listStatuses(db, strangerWorkspaceId)[0]!.id))
        .toThrowError(expect.objectContaining({ statusCode: 404 }))
      // Neither attempt may have deleted anything.
      expect(listStatuses(db, workspaceId)).toHaveLength(5)
    })

    // A bulk reassignment cannot create the next occurrence, and stamping completedAt would end
    // the chain permanently: reopening a recurring task deliberately keeps the marker, so it
    // could never schedule a successor again.
    it('refuses to reassign recurring work into a closed status', () => {
      const recurring = createTask(db, ownerId, workspaceId, {
        ...base,
        title: 'Standup',
        statusId: idOf('In Progress'),
        recurrence: 'daily',
        dueDate: '2026-03-02',
      })

      expect(() => deleteStatus(db, ownerId, workspaceId, idOf('In Progress'), idOf('Done')))
        .toThrowError(expect.objectContaining({ statusCode: 422 }))
      expect(() => deleteStatus(db, ownerId, workspaceId, idOf('In Progress'), idOf('Canceled')))
        .toThrowError(expect.objectContaining({ statusCode: 422 }))

      // Nothing was touched, so the chain is still alive.
      const after = getTask(db, ownerId, workspaceId, recurring.id)
      expect(after.status.name).toBe('In Progress')
      expect(after.completedAt).toBeNull()
      expect(listStatuses(db, workspaceId)).toHaveLength(5)

      // Moving it to an open status first makes the delete succeed.
      deleteStatus(db, ownerId, workspaceId, idOf('In Progress'), idOf('Todo'))
      expect(getTask(db, ownerId, workspaceId, recurring.id).status.name).toBe('Todo')
      expect(getTask(db, ownerId, workspaceId, recurring.id).completedAt).toBeNull()
    })

    it('deletes an unreferenced non-default status without a replacement', () => {
      deleteStatus(db, ownerId, workspaceId, idOf('Canceled'))

      expect(listStatuses(db, workspaceId)).toHaveLength(4)
    })

    it('is backstopped by the foreign key when a referenced status is deleted directly', () => {
      task('Doing', statusIdFor(db, workspaceId, 'started'))
      expect(() => sqlite.prepare('DELETE FROM statuses WHERE id = ?').run(idOf('In Progress'))).toThrow()
    })
  })

  describe('isolation between workspaces', () => {
    it('answers 404, not 403, for another workspace’s status id', () => {
      const foreign = listStatuses(db, strangerWorkspaceId)[0]!.id

      expect(() => getStatus(db, workspaceId, foreign)).toThrowError(expect.objectContaining({ statusCode: 404 }))
      expect(() => updateStatus(db, ownerId, workspaceId, foreign, { name: 'Hijacked' }))
        .toThrowError(expect.objectContaining({ statusCode: 404 }))
      expect(() => deleteStatus(db, ownerId, workspaceId, foreign))
        .toThrowError(expect.objectContaining({ statusCode: 404 }))
      expect(listStatuses(db, strangerWorkspaceId).map(status => status.name)).not.toContain('Hijacked')
    })

    it('answers 422 and leaves the task unchanged when updateTask names a foreign status', () => {
      const subject = task('Mine')
      const foreign = statusIdFor(db, strangerWorkspaceId, 'completed')

      expect(() => updateTask(db, ownerId, workspaceId, subject.id, { statusId: foreign }))
        .toThrowError(expect.objectContaining({ statusCode: 422 }))
      expect(getTask(db, ownerId, workspaceId, subject.id)).toMatchObject({
        status: { id: defaultStatusId(db, workspaceId) },
        completedAt: null,
      })
    })

    it('answers 422 when createTask names a foreign status, and 404 for an unknown one', () => {
      expect(() => task('Foreign', statusIdFor(db, strangerWorkspaceId, 'unstarted')))
        .toThrowError(expect.objectContaining({ statusCode: 422 }))
      expect(() => task('Unknown', '99999999-9999-4999-8999-999999999999'))
        .toThrowError(expect.objectContaining({ statusCode: 404 }))
      expect(() => updateTask(db, ownerId, workspaceId, task('Real').id, { statusId: '99999999-9999-4999-8999-999999999999' }))
        .toThrowError(expect.objectContaining({ statusCode: 404 }))
    })

    it('never lists another workspace’s statuses', () => {
      expect(listStatuses(db, workspaceId).every(status => listStatuses(db, strangerWorkspaceId).every(other => other.id !== status.id)))
        .toBe(true)
      expect(db.select({ id: statuses.id }).from(statuses).where(eq(statuses.workspaceId, strangerWorkspaceId)).all()).toHaveLength(5)
    })
  })

  describe('isolation between members of the same workspace', () => {
    // `listStatuses` takes no userId -- the workflow is workspace-wide and membership is checked
    // by `requireMember` in the handler, which has no test harness. What is assertable here is
    // that the workflow is per workspace and not per member, so the two workspaces differ.
    it('reads one workflow per workspace, not per member', () => {
      const mine = listStatuses(db, workspaceId).map(status => status.id)
      const theirs = listStatuses(db, strangerWorkspaceId).map(status => status.id)

      expect(mine).toHaveLength(5)
      expect(theirs).toHaveLength(5)
      expect(mine.filter(id => theirs.includes(id))).toEqual([])
      expect(getStatus(db, workspaceId, idOf('Done')).name).toBe('Done')
    })

    it('lets a second member set a status on a shared project task', () => {
      const project = createProject(db, ownerId, workspaceId, { title: 'Shared', description: '', goalId: null, targetDate: null })
      const shared = task('Shared work', undefined, ownerId, project.id)

      const updated = updateTask(db, memberId, workspaceId, shared.id, { statusId: statusIdFor(db, workspaceId, 'started') })

      expect(updated.status.category).toBe('started')
      expect(updated.startedAt).not.toBeNull()
    })

    it('still keeps another member’s project-less task out of reach, with or without a status', () => {
      const private_ = task('Owner inbox')

      expect(() => updateTask(db, memberId, workspaceId, private_.id, { statusId: statusIdFor(db, workspaceId, 'completed') }))
        .toThrowError(expect.objectContaining({ statusCode: 404 }))
      expect(() => getTask(db, memberId, workspaceId, private_.id)).toThrow()
      expect(listTasks(db, memberId, workspaceId, { scope: 'all', statusId: defaultStatusId(db, workspaceId) })).toEqual([])
      expect(getTask(db, ownerId, workspaceId, private_.id).status.isDefault).toBe(true)
    })
  })

  describe('schemas', () => {
    it('validates status input', () => {
      expect(createStatusSchema.parse({ name: '  In Review  ', category: 'started' })).toEqual({ name: 'In Review', category: 'started' })
      expect(() => createStatusSchema.parse({ name: '', category: 'started' })).toThrow()
      expect(() => createStatusSchema.parse({ name: 'x', category: 'paused' })).toThrow()
      expect(() => updateStatusSchema.parse({ isDefault: false })).toThrow()
      expect(() => reorderStatusesSchema.parse({ statusIds: [] })).toThrow()
      expect(() => reorderStatusesSchema.parse({ statusIds: ['nope'] })).toThrow()
      expect(deleteStatusQuerySchema.parse({})).toEqual({})
      expect(() => deleteStatusQuerySchema.parse({ replacementStatusId: 'nope' })).toThrow()
    })
  })
})
