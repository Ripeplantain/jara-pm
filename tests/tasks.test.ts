import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { KobiDatabase } from '../server/db'
import { users } from '../server/db/schema'
import { createProject } from '../server/services/projects'
import { createTask, listTasks, updateTask } from '../server/services/tasks'
import { collectionQuerySchema } from '../shared/schemas/query'
import { taskQuerySchema } from '../shared/schemas/task'
import { initializeDatabase } from '../server/utils/database'
import { todayIso } from '../server/utils/time'
import { createWorkspaceForUser, statusIdFor } from './workspace-fixtures'

describe('task service', () => {
  let sqlite: Database.Database
  let db: KobiDatabase
  let workspaceId: string

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
    workspaceId = createWorkspaceForUser(db, '11111111-1111-4111-8111-111111111111')
    createWorkspaceForUser(db, '22222222-2222-4222-8222-222222222222')
  })

  afterEach(() => sqlite.close())

  const completedId = () => statusIdFor(db, workspaceId, 'completed')
  const startedId = () => statusIdFor(db, workspaceId, 'started')
  const unstartedId = () => statusIdFor(db, workspaceId, 'unstarted')

  it('isolates every task list by the authenticated user', () => {
    createTask(db, '11111111-1111-4111-8111-111111111111', {
      title: 'Private to one', description: '', priority: 'none',
      dueDate: null, scheduledFor: null, recurrence: 'none', selectedForToday: false,
      projectId: null, milestoneId: null, parentId: null,
    })
    createTask(db, '22222222-2222-4222-8222-222222222222', {
      title: 'Private to two', description: '', priority: 'none',
      dueDate: null, scheduledFor: null, recurrence: 'none', selectedForToday: false,
      projectId: null, milestoneId: null, parentId: null,
    })

    expect(listTasks(db, '11111111-1111-4111-8111-111111111111', { scope: 'all' }).map(task => task.title))
      .toEqual(['Private to one'])
  })

  it('keeps future-dated fallback work out of Today while preserving explicit Today work', () => {
    const owner = '11111111-1111-4111-8111-111111111111'
    const today = todayIso()
    const future = '2099-12-31'
    const project = createProject(db, owner, workspaceId, {
      title: 'Today filtering', description: '', goalId: null, targetDate: null,
    })
    const base = {
      description: '', priority: 'none' as const,
      recurrence: 'none' as const, projectId: null, milestoneId: null, parentId: null,
    }

    createTask(db, owner, {
      ...base, title: 'Future inbox', dueDate: future, scheduledFor: null, selectedForToday: false,
    })
    createTask(db, owner, {
      ...base, title: 'Future schedule', dueDate: null, scheduledFor: future, selectedForToday: false,
    })
    createTask(db, owner, {
      ...base, title: 'Future assigned project', dueDate: future, scheduledFor: null,
      selectedForToday: false, projectId: project.id,
    })
    createTask(db, owner, {
      ...base, title: 'Due today', dueDate: today, scheduledFor: null, selectedForToday: false,
    })
    createTask(db, owner, {
      ...base, title: 'Scheduled today', dueDate: future, scheduledFor: today, selectedForToday: false,
    })
    createTask(db, owner, {
      ...base, title: 'Selected today', dueDate: future, scheduledFor: null, selectedForToday: true,
    })
    createTask(db, owner, {
      ...base, title: 'Undated inbox', dueDate: null, scheduledFor: null, selectedForToday: false,
    })
    createTask(db, owner, {
      ...base, title: 'Undated assigned project', dueDate: null, scheduledFor: null,
      selectedForToday: false, projectId: project.id,
    })

    expect(listTasks(db, owner, { scope: 'today' }).map(task => task.title)).toEqual([
      'Due today',
      'Scheduled today',
      'Selected today',
      'Undated assigned project',
      'Undated inbox',
    ])
  })

  it('completes a task without changing omitted fields', () => {
    const task = createTask(db, '11111111-1111-4111-8111-111111111111', {
      title: 'Keep my fields', description: '', priority: 'high',
      dueDate: null, scheduledFor: null, recurrence: 'none', selectedForToday: true,
      projectId: null, milestoneId: null, parentId: null,
    })
    const updated = updateTask(db, '11111111-1111-4111-8111-111111111111', task.id, { statusId: completedId() })

    expect(updated.priority).toBe('high')
    expect(updated.selectedForToday).toBe(true)
    expect(updated.completedAt).not.toBeNull()
  })

  it('creates the next daily occurrence when a recurring task is completed', () => {
    const task = createTask(db, '11111111-1111-4111-8111-111111111111', {
      title: 'Walk', description: 'Outside', priority: 'medium',
      dueDate: '2099-01-01', scheduledFor: null, recurrence: 'daily', selectedForToday: false,
      projectId: null, milestoneId: null, parentId: null,
    })

    const completed = updateTask(db, '11111111-1111-4111-8111-111111111111', task.id, { statusId: completedId() })
    const occurrences = listTasks(db, '11111111-1111-4111-8111-111111111111', { scope: 'all' })

    expect(completed.recurrence).toBe('daily')
    expect(occurrences).toHaveLength(2)
    expect(occurrences.find(item => item.id !== task.id)).toMatchObject({
      title: 'Walk', description: 'Outside', priority: 'medium',
      dueDate: '2099-01-02', recurrence: 'daily', startedAt: null,
    })
    // The successor lands in the workspace's default status, not wherever the original ended.
    expect(occurrences.find(item => item.id !== task.id)?.status).toMatchObject({ id: unstartedId(), isDefault: true })
  })

  it('does not create another occurrence when an already completed task is updated again', () => {
    const task = createTask(db, '11111111-1111-4111-8111-111111111111', {
      title: 'Journal', description: '', priority: 'none',
      dueDate: '2099-02-01', scheduledFor: null, recurrence: 'weekly', selectedForToday: false,
      projectId: null, milestoneId: null, parentId: null,
    })

    updateTask(db, '11111111-1111-4111-8111-111111111111', task.id, { statusId: completedId() })
    updateTask(db, '11111111-1111-4111-8111-111111111111', task.id, { statusId: completedId() })

    expect(listTasks(db, '11111111-1111-4111-8111-111111111111', { scope: 'all' })).toHaveLength(2)
  })

  it('does not duplicate a recurring successor after reopening and recompleting its occurrence', () => {
    const owner = '11111111-1111-4111-8111-111111111111'
    const task = createTask(db, owner, {
      title: 'Review notes', description: '', priority: 'none',
      dueDate: '2099-02-01', scheduledFor: null, recurrence: 'weekly', selectedForToday: false,
      projectId: null, milestoneId: null, parentId: null,
    })

    updateTask(db, owner, task.id, { statusId: completedId() })
    const reopened = updateTask(db, owner, task.id, { statusId: startedId() })
    updateTask(db, owner, task.id, { statusId: completedId() })

    expect(reopened.completedAt).not.toBeNull()
    expect(listTasks(db, owner, { scope: 'all' })).toHaveLength(2)
  })

  it('requires a due date for recurring tasks', () => {
    expect(() => createTask(db, '11111111-1111-4111-8111-111111111111', {
      title: 'Invalid recurring task', description: '', priority: 'none',
      dueDate: null, scheduledFor: null, recurrence: 'daily', selectedForToday: false,
      projectId: null, milestoneId: null, parentId: null,
    })).toThrow()
  })

  it('requires a due date when enabling recurrence or clearing a recurring due date', () => {
    const task = createTask(db, '11111111-1111-4111-8111-111111111111', {
      title: 'Plan', description: '', priority: 'none',
      dueDate: null, scheduledFor: null, recurrence: 'none', selectedForToday: false,
      projectId: null, milestoneId: null, parentId: null,
    })

    expect(() => updateTask(db, '11111111-1111-4111-8111-111111111111', task.id, {
      recurrence: 'daily',
    })).toThrow()

    const recurring = createTask(db, '11111111-1111-4111-8111-111111111111', {
      title: 'Review', description: '', priority: 'none',
      dueDate: '2099-03-01', scheduledFor: null, recurrence: 'weekly', selectedForToday: false,
      projectId: null, milestoneId: null, parentId: null,
    })
    expect(() => updateTask(db, '11111111-1111-4111-8111-111111111111', recurring.id, {
      dueDate: null,
    })).toThrow()
  })

  it('does not enable recurrence on a completed task without an occurrence', () => {
    const task = createTask(db, '11111111-1111-4111-8111-111111111111', {
      title: 'Finished plan', description: '', priority: 'none',
      dueDate: '2099-03-01', scheduledFor: null, recurrence: 'none', selectedForToday: false,
      projectId: null, milestoneId: null, parentId: null,
    })
    updateTask(db, '11111111-1111-4111-8111-111111111111', task.id, { statusId: completedId() })

    expect(() => updateTask(db, '11111111-1111-4111-8111-111111111111', task.id, {
      recurrence: 'daily',
    })).toThrow()
  })

  it('rolls back completion when creating the next occurrence fails', () => {
    const task = createTask(db, '11111111-1111-4111-8111-111111111111', {
      title: 'Walk', description: '', priority: 'none',
      dueDate: '2099-04-01', scheduledFor: null, recurrence: 'daily', selectedForToday: false,
      projectId: null, milestoneId: null, parentId: null,
    })
    sqlite.exec(`
      CREATE TRIGGER reject_next_occurrence
      BEFORE INSERT ON tasks
      WHEN NEW.status_id = '${unstartedId()}' AND NEW.recurrence = 'daily'
      BEGIN
        SELECT RAISE(ABORT, 'next occurrence rejected');
      END;
    `)

    expect(() => updateTask(db, '11111111-1111-4111-8111-111111111111', task.id, { statusId: completedId() }))
      .toThrow('next occurrence rejected')
    expect(getTaskRow(sqlite, task.id)).toMatchObject({ status_id: unstartedId(), recurrence: 'daily' })
    expect(listTasks(db, '11111111-1111-4111-8111-111111111111', { scope: 'all' })).toHaveLength(1)
  })

  // The task panel lists a task's subtasks through this filter.
  describe('parent filter', () => {
    const owner = '11111111-1111-4111-8111-111111111111'
    const other = '22222222-2222-4222-8222-222222222222'
    const base = {
      description: '', priority: 'none' as const, scheduledFor: null, dueDate: null,
      recurrence: 'none' as const, selectedForToday: false,
      projectId: null, milestoneId: null, parentId: null,
    }

    it('returns only the children of the requested task', () => {
      const parent = createTask(db, owner, { ...base, title: 'Parent' })
      createTask(db, owner, { ...base, title: 'Child one', parentId: parent.id })
      createTask(db, owner, { ...base, title: 'Child two', parentId: parent.id })
      createTask(db, owner, { ...base, title: 'Unrelated' })

      const children = listTasks(db, owner, { scope: 'all', parentId: parent.id })

      expect(children.map(task => task.title).sort()).toEqual(['Child one', 'Child two'])
    })

    it('returns nothing for a task with no children', () => {
      const lonely = createTask(db, owner, { ...base, title: 'Lonely' })
      expect(listTasks(db, owner, { scope: 'all', parentId: lonely.id })).toEqual([])
    })

    // The filter must not become a way around the workspace and visibility predicates.
    it('does not leak another member’s subtasks', () => {
      const parent = createTask(db, owner, { ...base, title: 'Parent' })
      createTask(db, owner, { ...base, title: 'Child', parentId: parent.id })

      expect(listTasks(db, other, { scope: 'all', parentId: parent.id })).toEqual([])
    })
  })

  // The scoped views hide completed work, so a list had no way to show what it was hiding.
  describe('completed-task visibility', () => {
    const owner = '11111111-1111-4111-8111-111111111111'
    const base = {
      description: '', priority: 'none' as const, scheduledFor: null,
      recurrence: 'none' as const, selectedForToday: false,
      projectId: null, milestoneId: null, parentId: null,
    }

    const seed = () => {
      const open = createTask(db, owner, { ...base, title: 'Still open', dueDate: null })
      const done = createTask(db, owner, { ...base, title: 'Already finished', dueDate: null })
      updateTask(db, owner, done.id, { statusId: completedId() })
      return { open, done }
    }

    it('hides completed tasks from the inbox unless they are asked for', () => {
      seed()

      expect(listTasks(db, owner, { scope: 'inbox' }).map(task => task.title)).toEqual(['Still open'])
      expect(listTasks(db, owner, { scope: 'inbox', includeCompleted: true }).map(task => task.title))
        .toEqual(['Still open', 'Already finished'])
    })

    it('sorts completed tasks below open ones, as the list renders them', () => {
      seed()
      const titles = listTasks(db, owner, { scope: 'inbox', includeCompleted: true }).map(task => task.title)

      expect(titles.indexOf('Already finished')).toBeGreaterThan(titles.indexOf('Still open'))
    })

    it('hides completed tasks from upcoming unless they are asked for', () => {
      const soon = createTask(db, owner, { ...base, title: 'Due later', dueDate: '2099-05-01' })
      updateTask(db, owner, soon.id, { statusId: completedId() })
      createTask(db, owner, { ...base, title: 'Open later', dueDate: '2099-05-02' })

      expect(listTasks(db, owner, { scope: 'upcoming' }).map(task => task.title)).toEqual(['Open later'])
      expect(listTasks(db, owner, { scope: 'upcoming', includeCompleted: true }).map(task => task.title))
        .toContain('Due later')
    })

    it('leaves the all scope unchanged, since it never hid completed work', () => {
      seed()

      expect(listTasks(db, owner, { scope: 'all' })).toHaveLength(2)
    })

    // useFetch serializes a false query value as the string "false", which z.coerce.boolean()
    // would read as true and silently reveal completed work on every list.
    it('reads a false query flag as false', () => {
      expect(taskQuerySchema.parse({ scope: 'inbox', includeCompleted: 'false' }).includeCompleted).toBe(false)
      expect(taskQuerySchema.parse({ scope: 'inbox', includeCompleted: 'true' }).includeCompleted).toBe(true)
      expect(taskQuerySchema.parse({ scope: 'inbox' }).includeCompleted).toBeUndefined()
      expect(collectionQuerySchema.parse({ includeArchived: 'false' }).includeArchived).toBe(false)
      expect(collectionQuerySchema.parse({ includeArchived: 'true' }).includeArchived).toBe(true)
    })
  })

  describe('status categories', () => {
    const owner = '11111111-1111-4111-8111-111111111111'
    const base = {
      description: '', priority: 'none' as const, scheduledFor: null, dueDate: null,
      recurrence: 'none' as const, selectedForToday: false,
      projectId: null, milestoneId: null, parentId: null,
    }
    const make = (title: string, category?: 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled') =>
      createTask(db, owner, { ...base, title, statusId: category ? statusIdFor(db, workspaceId, category) : undefined })

    it('creates a task in the workspace default status when none is given', () => {
      const task = make('Default')

      expect(task.status).toMatchObject({ id: unstartedId(), category: 'unstarted', isDefault: true })
      expect(task.startedAt).toBeNull()
      expect(task.completedAt).toBeNull()
    })

    it('stamps startedAt on creation in a started status and not in an unstarted one', () => {
      expect(make('Begun', 'started').startedAt).not.toBeNull()
      expect(make('Waiting', 'unstarted').startedAt).toBeNull()
    })

    it('sets startedAt once and never clears it across started, completed and started again', () => {
      const task = make('Cycle time')
      const first = updateTask(db, owner, task.id, { statusId: startedId() })
      expect(first.startedAt).not.toBeNull()

      // Age the marker so a rewrite would be visible even within the same millisecond.
      sqlite.prepare('UPDATE tasks SET started_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', task.id)

      const completed = updateTask(db, owner, task.id, { statusId: completedId() })
      expect(completed.startedAt).toBe('2020-01-01T00:00:00.000Z')
      expect(completed.completedAt).not.toBeNull()

      const again = updateTask(db, owner, task.id, { statusId: startedId() })
      expect(again.startedAt).toBe('2020-01-01T00:00:00.000Z')
      expect(again.completedAt).toBeNull()
    })

    it('does not stamp startedAt when a task moves straight to completed', () => {
      const task = make('Quick win')
      expect(updateTask(db, owner, task.id, { statusId: completedId() }).startedAt).toBeNull()
    })

    it('sets completedAt on entering a completed status and clears it on leaving', () => {
      const task = make('Finish')
      const completed = updateTask(db, owner, task.id, { statusId: completedId() })
      expect(completed.completedAt).not.toBeNull()
      expect(completed.status.category).toBe('completed')

      const reopened = updateTask(db, owner, task.id, { statusId: unstartedId() })
      expect(reopened.completedAt).toBeNull()
    })

    it('does not treat a canceled task as completed', () => {
      const task = make('Dropped')
      const canceled = updateTask(db, owner, task.id, { statusId: statusIdFor(db, workspaceId, 'canceled') })

      expect(canceled.status.category).toBe('canceled')
      expect(canceled.completedAt).toBeNull()
    })

    it('hides canceled tasks from the inbox, today and upcoming unless completed work is asked for', () => {
      make('Open')
      const dropped = createTask(db, owner, { ...base, title: 'Dropped', dueDate: '2099-06-01' })
      updateTask(db, owner, dropped.id, { statusId: statusIdFor(db, workspaceId, 'canceled') })

      expect(listTasks(db, owner, { scope: 'inbox' }).map(task => task.title)).toEqual(['Open'])
      expect(listTasks(db, owner, { scope: 'today' }).map(task => task.title)).toEqual(['Open'])
      expect(listTasks(db, owner, { scope: 'upcoming' })).toEqual([])
      expect(listTasks(db, owner, { scope: 'inbox', includeCompleted: true }).map(task => task.title).sort())
        .toEqual(['Dropped', 'Open'])
      expect(listTasks(db, owner, { scope: 'upcoming', includeCompleted: true }).map(task => task.title))
        .toEqual(['Dropped'])
    })

    it('sorts completed and canceled tasks below open ones, then by status position', () => {
      make('Canceled one', 'canceled')
      make('Done one', 'completed')
      make('Started one', 'started')
      make('Todo one', 'unstarted')

      expect(listTasks(db, owner, { scope: 'all' }).map(task => task.title))
        .toEqual(['Todo one', 'Started one', 'Done one', 'Canceled one'])
    })

    it('keeps backlog work out of Today while the Inbox still shows it', () => {
      make('Parked', 'backlog')
      make('Ready', 'unstarted')

      expect(listTasks(db, owner, { scope: 'today' }).map(task => task.title)).toEqual(['Ready'])
      expect(listTasks(db, owner, { scope: 'inbox' }).map(task => task.title).sort()).toEqual(['Parked', 'Ready'])
    })

    it('still shows a backlog task that was explicitly selected for Today', () => {
      createTask(db, owner, { ...base, title: 'Pinned', selectedForToday: true, statusId: statusIdFor(db, workspaceId, 'backlog') })

      expect(listTasks(db, owner, { scope: 'today' }).map(task => task.title)).toEqual(['Pinned'])
    })

    it('filters by category and by exact status id', () => {
      make('Parked', 'backlog')
      make('Doing', 'started')
      make('Waiting', 'unstarted')

      expect(listTasks(db, owner, { scope: 'all', category: 'backlog' }).map(task => task.title)).toEqual(['Parked'])
      expect(listTasks(db, owner, { scope: 'all', statusId: startedId() }).map(task => task.title)).toEqual(['Doing'])
    })

    it('rejects a recurring task created in a completed or canceled status', () => {
      for (const category of ['completed', 'canceled'] as const) {
        expect(() => createTask(db, owner, {
          ...base, title: 'Closed recurring', dueDate: '2099-01-01', recurrence: 'daily',
          statusId: statusIdFor(db, workspaceId, category),
        })).toThrowError(expect.objectContaining({ statusMessage: expect.stringContaining('Recurring tasks must start open') }))
      }
    })

    it('creates a recurring successor in the default status with startedAt null', () => {
      const task = createTask(db, owner, {
        ...base, title: 'Standup', dueDate: '2099-01-01', recurrence: 'daily', statusId: startedId(),
      })
      expect(task.startedAt).not.toBeNull()

      updateTask(db, owner, task.id, { statusId: completedId() })
      const successor = listTasks(db, owner, { scope: 'all' }).find(item => item.id !== task.id)

      expect(successor?.status.id).toBe(unstartedId())
      expect(successor?.startedAt).toBeNull()
      expect(successor?.completedAt).toBeNull()
    })
  })

  it('does not let another user complete a recurring task or create its occurrence', () => {
    const task = createTask(db, '11111111-1111-4111-8111-111111111111', {
      title: 'Private walk', description: '', priority: 'none',
      dueDate: '2099-05-01', scheduledFor: null, recurrence: 'daily', selectedForToday: false,
      projectId: null, milestoneId: null, parentId: null,
    })

    expect(() => updateTask(db, '22222222-2222-4222-8222-222222222222', task.id, { statusId: completedId() }))
      .toThrow()
    expect(listTasks(db, '11111111-1111-4111-8111-111111111111', { scope: 'all' })).toHaveLength(1)
    expect(listTasks(db, '22222222-2222-4222-8222-222222222222', { scope: 'all' })).toHaveLength(0)
  })
})

const getTaskRow = (sqlite: Database.Database, taskId: string) =>
  sqlite.prepare('SELECT status_id, recurrence FROM tasks WHERE id = ?').get(taskId) as {
    status_id: string
    recurrence: string
  }
