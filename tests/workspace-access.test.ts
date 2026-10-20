import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { createGoal, getGoal, listGoals } from '../server/services/goals'
import { createProject, getProject, listProjects } from '../server/services/projects'
import { createTask, getTask, listTasks, updateTask } from '../server/services/tasks'
import { users, workspaceMembers } from '../server/db/schema'
import { initializeDatabase } from '../server/utils/database'
import { createWorkspaceForUser } from './workspace-fixtures'
import { workspaceIdForUser } from '../server/utils/workspace'

const userOne = 'workspace-access-one'
const userTwo = 'workspace-access-two'

const insertUser = (db: ReturnType<typeof initializeDatabase>, id: string, email: string) => {
  db.insert(users).values({
    id,
    email,
    name: id === userOne ? 'One' : 'Two',
    passwordHash: 'test-hash',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  }).run()
}

describe('workspace-scoped resource access', () => {
  const databases: Database.Database[] = []

  afterEach(() => {
    for (const database of databases) database.close()
    databases.length = 0
  })

  it('does not expose goals, projects, or tasks from another workspace', () => {
    const sqlite = new Database(':memory:')
    databases.push(sqlite)
    const db = initializeDatabase(sqlite)
    insertUser(db, userOne, 'one@example.test')
    insertUser(db, userTwo, 'two@example.test')
    const workspaceOne = createWorkspaceForUser(db, userOne)
    const workspaceTwo = createWorkspaceForUser(db, userTwo)

    expect(() => workspaceIdForUser(db, userOne, workspaceTwo)).toThrow()

    const goal = createGoal(db, userOne, workspaceOne, { title: 'Private goal', description: '', targetDate: null })
    const project = createProject(db, userOne, workspaceOne, {
      title: 'Private project', description: '', goalId: goal.id, targetDate: null,
    })
    const task = createTask(db, userOne, workspaceOne, {
      title: 'Private task', description: '', status: 'todo', priority: 'none',
      dueDate: null, scheduledFor: null, recurrence: 'none', selectedForToday: false,
      projectId: project.id, milestoneId: null, parentId: null,
    })

    expect(listGoals(db, userTwo, workspaceTwo)).toEqual([])
    expect(listProjects(db, userTwo, workspaceTwo)).toEqual([])
    expect(listTasks(db, userTwo, workspaceTwo, { scope: 'all' })).toEqual([])
    expect(() => getGoal(db, userTwo, workspaceTwo, goal.id)).toThrow()
    expect(() => getProject(db, userTwo, workspaceTwo, project.id)).toThrow()
    expect(() => getTask(db, userTwo, workspaceTwo, task.id)).toThrow()

    db.delete(workspaceMembers).where(and(
      eq(workspaceMembers.workspaceId, workspaceOne),
      eq(workspaceMembers.userId, userOne),
    )).run()
    expect(() => workspaceIdForUser(db, userOne)).toThrow()
  })

  it('keeps inbox tasks private between members of the same workspace', () => {
    const sqlite = new Database(':memory:')
    databases.push(sqlite)
    const db = initializeDatabase(sqlite)
    insertUser(db, userOne, 'one@example.test')
    insertUser(db, userTwo, 'two@example.test')
    const workspaceId = createWorkspaceForUser(db, userOne)
    db.insert(workspaceMembers).values({
      workspaceId,
      userId: userTwo,
      role: 'member',
      joinedAt: '2026-01-01',
    }).run()
    db.update(users).set({ activeWorkspaceId: workspaceId }).where(eq(users.id, userTwo)).run()

    const inboxTask = createTask(db, userOne, workspaceId, {
      title: 'Private inbox', description: '', status: 'todo', priority: 'none',
      dueDate: null, scheduledFor: null, recurrence: 'none', selectedForToday: false,
      projectId: null, milestoneId: null, parentId: null,
    })

    expect(listTasks(db, userOne, workspaceId, { scope: 'inbox' }).map(task => task.id)).toEqual([inboxTask.id])
    expect(listTasks(db, userTwo, workspaceId, { scope: 'all' })).toEqual([])
    expect(listTasks(db, userTwo, workspaceId, { scope: 'inbox' })).toEqual([])
    expect(() => getTask(db, userTwo, workspaceId, inboxTask.id)).toThrow()
  })

  it('keeps day selections per requester while showing assigned project work', () => {
    const sqlite = new Database(':memory:')
    databases.push(sqlite)
    const db = initializeDatabase(sqlite)
    insertUser(db, userOne, 'one@example.test')
    insertUser(db, userTwo, 'two@example.test')
    const workspaceId = createWorkspaceForUser(db, userOne)
    db.insert(workspaceMembers).values({ workspaceId, userId: userTwo, role: 'member', joinedAt: '2026-01-01' }).run()
    db.update(users).set({ activeWorkspaceId: workspaceId }).where(eq(users.id, userTwo)).run()

    const project = createProject(db, userOne, workspaceId, {
      title: 'Shared project', description: '', goalId: null, targetDate: null,
    })
    const task = createTask(db, userOne, workspaceId, {
      title: 'Shared assigned task', description: '', status: 'todo', priority: 'none',
      dueDate: null, scheduledFor: null, recurrence: 'none', selectedForToday: true,
      assigneeId: userTwo, projectId: project.id, milestoneId: null, parentId: null,
    })

    expect(listTasks(db, userTwo, workspaceId, { scope: 'today' }).map(item => item.id)).toEqual([task.id])
    expect(listTasks(db, userOne, workspaceId, { scope: 'today' }).map(item => item.id)).toEqual([task.id])
    expect(getTask(db, userTwo, workspaceId, task.id).selectedForToday).toBe(false)
    expect(getTask(db, userOne, workspaceId, task.id).selectedForToday).toBe(true)
  })

  it('filters shared project tasks by assignee without leaking inbox tasks', () => {
    const sqlite = new Database(':memory:')
    databases.push(sqlite)
    const db = initializeDatabase(sqlite)
    insertUser(db, userOne, 'one@example.test')
    insertUser(db, userTwo, 'two@example.test')
    const workspaceId = createWorkspaceForUser(db, userOne)
    db.insert(workspaceMembers).values({ workspaceId, userId: userTwo, role: 'member', joinedAt: '2026-01-01' }).run()
    db.update(users).set({ activeWorkspaceId: workspaceId }).where(eq(users.id, userTwo)).run()

    const project = createProject(db, userOne, workspaceId, {
      title: 'Assignments', description: '', goalId: null, targetDate: null,
    })
    const assignedToOne = createTask(db, userOne, workspaceId, {
      title: 'One task', description: '', status: 'todo', priority: 'none',
      dueDate: null, scheduledFor: null, recurrence: 'none', selectedForToday: false,
      assigneeId: userOne, projectId: project.id, milestoneId: null, parentId: null,
    })
    const assignedToTwo = createTask(db, userOne, workspaceId, {
      title: 'Two task', description: '', status: 'todo', priority: 'none',
      dueDate: null, scheduledFor: null, recurrence: 'none', selectedForToday: false,
      assigneeId: userTwo, projectId: project.id, milestoneId: null, parentId: null,
    })
    const unassigned = createTask(db, userOne, workspaceId, {
      title: 'Unassigned task', description: '', status: 'todo', priority: 'none',
      dueDate: null, scheduledFor: null, recurrence: 'none', selectedForToday: false,
      assigneeId: null, projectId: project.id, milestoneId: null, parentId: null,
    })

    expect(listTasks(db, userTwo, workspaceId, { scope: 'all', assignee: 'me' }).map(task => task.id))
      .toEqual([assignedToTwo.id])
    expect(listTasks(db, userTwo, workspaceId, { scope: 'all', assignee: 'unassigned' }).map(task => task.id))
      .toEqual([unassigned.id])
    expect(listTasks(db, userTwo, workspaceId, { scope: 'all', assignee: 'everyone' }).map(task => task.id))
      .toEqual([assignedToOne.id, assignedToTwo.id, unassigned.id])
  })

  it('updates a day selection only for the requester who changed it', () => {
    const sqlite = new Database(':memory:')
    databases.push(sqlite)
    const db = initializeDatabase(sqlite)
    insertUser(db, userOne, 'one@example.test')
    insertUser(db, userTwo, 'two@example.test')
    const workspaceId = createWorkspaceForUser(db, userOne)
    db.insert(workspaceMembers).values({ workspaceId, userId: userTwo, role: 'member', joinedAt: '2026-01-01' }).run()
    db.update(users).set({ activeWorkspaceId: workspaceId }).where(eq(users.id, userTwo)).run()

    const project = createProject(db, userOne, workspaceId, {
      title: 'Shared project', description: '', goalId: null, targetDate: null,
    })
    const task = createTask(db, userOne, workspaceId, {
      title: 'Select independently', description: '', status: 'todo', priority: 'none',
      dueDate: null, scheduledFor: null, recurrence: 'none', selectedForToday: false,
      assigneeId: userTwo, projectId: project.id, milestoneId: null, parentId: null,
    })

    updateTask(db, userTwo, workspaceId, task.id, { selectedForToday: true })
    expect(getTask(db, userTwo, workspaceId, task.id).selectedForToday).toBe(true)
    expect(getTask(db, userOne, workspaceId, task.id).selectedForToday).toBe(false)
    expect(listTasks(db, userTwo, workspaceId, { scope: 'today' }).map(item => item.id)).toEqual([task.id])
    expect(listTasks(db, userOne, workspaceId, { scope: 'today' })).toEqual([])
  })
})
