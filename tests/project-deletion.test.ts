import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { KobiDatabase } from '../server/db'
import { goals, milestones, projects, tasks, users } from '../server/db/schema'
import { createGoal, deleteGoal, getGoal } from '../server/services/goals'
import { createMilestone, createProject, deleteProject, updateProject } from '../server/services/projects'
import { createTask, listTasks } from '../server/services/tasks'
import { initializeDatabase } from '../server/utils/database'
import { createWorkspaceForUser } from './workspace-fixtures'

const owner = '11111111-1111-4111-8111-111111111111'

describe('project and goal deletion', () => {
  let sqlite: Database.Database
  let db: KobiDatabase
  let workspaceId: string

  beforeEach(() => {
    sqlite = new Database(':memory:')
    db = initializeDatabase(sqlite)
    const now = new Date().toISOString()
    db.insert(users).values({
      id: owner, email: 'one@example.test', name: 'One', passwordHash: 'test-hash', createdAt: now, updatedAt: now,
    }).run()
    workspaceId = createWorkspaceForUser(db, owner)
  })

  afterEach(() => sqlite.close())

  const project = (title: string, goalId: string | null = null) =>
    createProject(db, owner, workspaceId, { title, description: '', goalId, targetDate: null })
  const goal = (title: string) =>
    createGoal(db, owner, workspaceId, { title, description: '', targetDate: null })
  const task = (title: string, projectId: string | null) =>
    createTask(db, owner, {
      title, description: '', priority: 'none', dueDate: null, scheduledFor: null,
      recurrence: 'none', selectedForToday: false, projectId, milestoneId: null, parentId: null,
    })

  it('hides tasks of archived projects from cross-project lists but not from the project itself', () => {
    const shelved = project('Shelved')
    task('In shelved', shelved.id)
    task('In inbox', null)
    updateProject(db, owner, workspaceId, shelved.id, { status: 'archived' })

    expect(listTasks(db, owner, workspaceId, { scope: 'all' }).map(t => t.title)).toEqual(['In inbox'])
    expect(listTasks(db, owner, workspaceId, { scope: 'all', projectId: shelved.id }).map(t => t.title))
      .toEqual(['In shelved'])
  })

  it('deletes the project with its tasks and milestones and removes a goal nothing else uses', () => {
    const lonely = goal('Lonely')
    const doomed = project('Doomed', lonely.id)
    createMilestone(db, owner, workspaceId, doomed.id, { title: 'M1', description: '', targetDate: null })
    task('Gone', doomed.id)
    task('Stays', null)

    const result = deleteProject(db, owner, workspaceId, doomed.id)

    expect(result).toEqual({ deletedTaskCount: 1, deletedMilestoneCount: 1, deletedGoalId: lonely.id })
    expect(db.select().from(projects).all()).toHaveLength(0)
    expect(db.select().from(milestones).all()).toHaveLength(0)
    expect(db.select().from(goals).all()).toHaveLength(0)
    expect(db.select().from(tasks).all().map(t => t.title)).toEqual(['Stays'])
  })

  it('keeps the goal while another project, archived or not, still references it', () => {
    const shared = goal('Shared')
    const first = project('First', shared.id)
    const second = project('Second', shared.id)
    updateProject(db, owner, workspaceId, second.id, { status: 'archived' })

    expect(deleteProject(db, owner, workspaceId, first.id).deletedGoalId).toBeNull()
    expect(getGoal(db, owner, workspaceId, shared.id).id).toBe(shared.id)
    expect(deleteProject(db, owner, workspaceId, second.id).deletedGoalId).toBe(shared.id)
  })

  it('deletes a goal with all of its projects and tasks', () => {
    const target = goal('Target')
    const live = project('Live', target.id)
    const archived = project('Archived', target.id)
    updateProject(db, owner, workspaceId, archived.id, { status: 'archived' })
    task('A', live.id)
    task('B', archived.id)
    const other = project('Unrelated')
    task('C', other.id)

    expect(deleteGoal(db, owner, workspaceId, target.id)).toEqual({ deletedProjectCount: 2 })
    expect(db.select().from(projects).all().map(p => p.id)).toEqual([other.id])
    expect(db.select().from(tasks).all().map(t => t.title)).toEqual(['C'])
  })

  it('answers 404 for a project that does not exist', () => {
    expect(() => deleteProject(db, owner, workspaceId, crypto.randomUUID())).toThrow()
  })
})
