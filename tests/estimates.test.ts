import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { KobiDatabase } from '../server/db'
import { users } from '../server/db/schema'
import { createGoal, getGoal } from '../server/services/goals'
import { createProject, getProject } from '../server/services/projects'
import { createTask, updateTask } from '../server/services/tasks'
import { updateWorkspace } from '../server/services/workspace'
import { createTaskSchema } from '../shared/schemas/task'
import { ESTIMATE_SCALE_OPTIONS, estimateLabel, estimateOptions, MAX_ESTIMATE, taskPoints } from '../shared/utils/estimates'
import { calculateWeightedProgress } from '../shared/utils/progress'
import { initializeDatabase } from '../server/utils/database'
import { createWorkspaceForUser } from './workspace-fixtures'

const userOne = '11111111-1111-4111-8111-111111111111'

const taskInput = (title: string, overrides: Record<string, unknown> = {}) => ({
  title,
  description: '',
  status: 'todo' as const,
  priority: 'none' as const,
  dueDate: null,
  scheduledFor: null,
  recurrence: 'none' as const,
  selectedForToday: false,
  estimate: null,
  labelIds: [],
  projectId: null,
  milestoneId: null,
  parentId: null,
  ...overrides,
})

describe('estimate scales', () => {
  it('defines every scale as ascending points', () => {
    for (const [scale, options] of Object.entries(ESTIMATE_SCALE_OPTIONS)) {
      const values = options.map(option => option.value)
      expect(values, scale).toEqual([...values].sort((a, b) => a - b))
      expect(new Set(values).size, scale).toBe(values.length)
      for (const value of values) {
        expect(value, scale).toBeGreaterThanOrEqual(1)
        expect(value, scale).toBeLessThanOrEqual(MAX_ESTIMATE)
      }
    }
  })

  it('offers nothing at all when estimates are off', () => {
    expect(estimateOptions('none')).toEqual([])
  })

  it('labels t-shirt sizes while storing them as points', () => {
    expect(estimateOptions('tshirt').map(option => option.label))
      .toEqual(['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'])
    expect(estimateLabel('tshirt', 8)).toBe('XL')
    expect(estimateLabel('fibonacci', 8)).toBe('8')
  })

  it('still renders a stored value the current scale would not offer', () => {
    // A scale change must not make an existing estimate unreadable.
    expect(estimateLabel('exponential', 13)).toBe('13')
    expect(estimateLabel('tshirt', 4)).toBe('4')
    expect(estimateLabel('none', 5)).toBe('5')
    expect(estimateLabel('fibonacci', null)).toBeNull()
  })

  it('weighs an unestimated task as one point', () => {
    expect(taskPoints(null)).toBe(1)
    expect(taskPoints(8)).toBe(8)
  })

  it('rejects estimates outside the column constraint', () => {
    const base = { title: 'Bounded' }
    expect(createTaskSchema.safeParse({ ...base, estimate: 0 }).success).toBe(false)
    expect(createTaskSchema.safeParse({ ...base, estimate: -1 }).success).toBe(false)
    expect(createTaskSchema.safeParse({ ...base, estimate: 1.5 }).success).toBe(false)
    expect(createTaskSchema.safeParse({ ...base, estimate: MAX_ESTIMATE + 1 }).success).toBe(false)
    expect(createTaskSchema.safeParse({ ...base, estimate: MAX_ESTIMATE }).success).toBe(true)
    expect(createTaskSchema.safeParse({ ...base, estimate: null }).success).toBe(true)
    expect(createTaskSchema.parse(base).estimate).toBeNull()
  })
})

describe('calculateWeightedProgress', () => {
  it('does not describe an empty collection as zero percent complete', () => {
    expect(calculateWeightedProgress([])).toBeNull()
  })

  it('matches count-based progress when nothing is estimated', () => {
    const tasks = [
      { estimate: null, completed: true },
      { estimate: null, completed: true },
      { estimate: null, completed: false },
    ]
    expect(calculateWeightedProgress(tasks)).toBe(67)
  })

  it('weighs estimated work by its points', () => {
    // 8 of 10 points done, which counting tasks would have called 50%.
    expect(calculateWeightedProgress([
      { estimate: 8, completed: true },
      { estimate: 2, completed: false },
    ])).toBe(80)
  })

  it('treats unestimated tasks in a mixed collection as one point', () => {
    // 1 + 8 = 9 points total, 1 done.
    expect(calculateWeightedProgress([
      { estimate: null, completed: true },
      { estimate: 8, completed: false },
    ])).toBe(11)
  })
})

describe('weighted progress through the services', () => {
  let sqlite: Database.Database
  let db: KobiDatabase
  let workspaceId: string

  beforeEach(() => {
    sqlite = new Database(':memory:')
    db = initializeDatabase(sqlite)
    const now = '2026-01-01T00:00:00.000Z'
    db.insert(users).values([
      { id: userOne, email: 'one@example.test', name: 'One', passwordHash: 'h', createdAt: now, updatedAt: now },
    ]).run()
    workspaceId = createWorkspaceForUser(db, userOne)
    updateWorkspace(db, userOne, workspaceId, { estimateScale: 'fibonacci' })
  })

  afterEach(() => sqlite.close())

  it('reports an empty project and an empty goal as unmeasured, not zero', () => {
    const goal = createGoal(db, userOne, workspaceId, { title: 'Empty goal', description: '', targetDate: null })
    const project = createProject(db, userOne, workspaceId, {
      title: 'Empty project', description: '', targetDate: null, goalId: goal.id,
    })

    expect(getProject(db, userOne, workspaceId, project.id).progress).toBeNull()
    expect(getGoal(db, userOne, workspaceId, goal.id).progress).toBeNull()
    expect(getProject(db, userOne, workspaceId, project.id).points).toBe(0)
  })

  it('weighs project progress by estimate and matches the pure helper', () => {
    const project = createProject(db, userOne, workspaceId, {
      title: 'Weighted', description: '', targetDate: null, goalId: null,
    })
    const big = createTask(db, userOne, workspaceId, taskInput('Big', { projectId: project.id, estimate: 8 }))
    createTask(db, userOne, workspaceId, taskInput('Small', { projectId: project.id, estimate: 2 }))
    updateTask(db, userOne, workspaceId, big.id, { status: 'done' })

    const loaded = getProject(db, userOne, workspaceId, project.id)
    expect(loaded.points).toBe(10)
    expect(loaded.completedPoints).toBe(8)
    expect(loaded.progress).toBe(80)
    // The SQL aggregate and the in-memory helper must not drift apart.
    expect(loaded.progress).toBe(calculateWeightedProgress([
      { estimate: 8, completed: true },
      { estimate: 2, completed: false },
    ]))
    // Counts stay available and keep counting tasks, not points.
    expect(loaded.taskCount).toBe(2)
    expect(loaded.completedTaskCount).toBe(1)
  })

  it('produces the pre-estimate number when no task is estimated', () => {
    const project = createProject(db, userOne, workspaceId, {
      title: 'Unestimated', description: '', targetDate: null, goalId: null,
    })
    const first = createTask(db, userOne, workspaceId, taskInput('One', { projectId: project.id }))
    createTask(db, userOne, workspaceId, taskInput('Two', { projectId: project.id }))
    createTask(db, userOne, workspaceId, taskInput('Three', { projectId: project.id }))
    updateTask(db, userOne, workspaceId, first.id, { status: 'done' })

    const loaded = getProject(db, userOne, workspaceId, project.id)
    expect(loaded.points).toBe(loaded.taskCount)
    expect(loaded.progress).toBe(33)
  })

  it('counts an unestimated task as one point beside estimated ones', () => {
    const project = createProject(db, userOne, workspaceId, {
      title: 'Mixed', description: '', targetDate: null, goalId: null,
    })
    const done = createTask(db, userOne, workspaceId, taskInput('Done', { projectId: project.id }))
    createTask(db, userOne, workspaceId, taskInput('Open', { projectId: project.id, estimate: 8 }))
    updateTask(db, userOne, workspaceId, done.id, { status: 'done' })

    const loaded = getProject(db, userOne, workspaceId, project.id)
    expect(loaded.points).toBe(9)
    expect(loaded.completedPoints).toBe(1)
    expect(loaded.progress).toBe(11)
  })

  it('rolls weighted progress up through milestones and goals', () => {
    const goal = createGoal(db, userOne, workspaceId, { title: 'Ship', description: '', targetDate: null })
    const project = createProject(db, userOne, workspaceId, {
      title: 'Rolled up', description: '', targetDate: null, goalId: goal.id,
    })
    const big = createTask(db, userOne, workspaceId, taskInput('Big', { projectId: project.id, estimate: 13 }))
    createTask(db, userOne, workspaceId, taskInput('Tiny', { projectId: project.id, estimate: 1 }))
    updateTask(db, userOne, workspaceId, big.id, { status: 'done' })

    const loaded = getGoal(db, userOne, workspaceId, goal.id)
    expect(loaded.points).toBe(14)
    expect(loaded.completedPoints).toBe(13)
    expect(loaded.progress).toBe(93)
  })

  it('ignores stored estimates while the workspace scale is none', () => {
    const project = createProject(db, userOne, workspaceId, {
      title: 'Scaled off', description: '', targetDate: null, goalId: null,
    })
    createTask(db, userOne, workspaceId, taskInput('Big', { projectId: project.id, estimate: 13 }))
    const small = createTask(db, userOne, workspaceId, taskInput('Small', { projectId: project.id, estimate: 1 }))
    updateTask(db, userOne, workspaceId, small.id, { status: 'done' })

    // Weighted: 1 of 14 points done.
    expect(getProject(db, userOne, workspaceId, project.id).progress).toBe(7)

    updateWorkspace(db, userOne, workspaceId, { estimateScale: 'none' })

    // With no scale there is no estimate field in the UI, so progress must match the task
    // counts shown beside it: 1 of 2 tasks done.
    const after = getProject(db, userOne, workspaceId, project.id)
    expect(after.progress).toBe(50)
    expect(after.points).toBe(2)
    expect(after.completedPoints).toBe(1)
    // The estimates themselves are kept, ready for the scale being turned back on.
    expect(getProject(db, userOne, workspaceId, project.id).taskCount).toBe(2)
    updateWorkspace(db, userOne, workspaceId, { estimateScale: 'fibonacci' })
    expect(getProject(db, userOne, workspaceId, project.id).progress).toBe(7)
  })

  it('does not rewrite stored estimates when the workspace scale changes', () => {
    const task = createTask(db, userOne, workspaceId, taskInput('Sized', { estimate: 13 }))

    expect(updateWorkspace(db, userOne, workspaceId, { estimateScale: 'fibonacci' }).estimateScale).toBe('fibonacci')
    // 13 is not a value the exponential scale offers, and it must survive anyway.
    expect(updateWorkspace(db, userOne, workspaceId, { estimateScale: 'exponential' }).estimateScale).toBe('exponential')
    expect(updateWorkspace(db, userOne, workspaceId, { estimateScale: 'none' }).estimateScale).toBe('none')

    expect(createTaskSchema.parse({ title: 'Sized', estimate: 13 }).estimate).toBe(13)
    expect(updateTask(db, userOne, workspaceId, task.id, {}).estimate).toBe(13)
  })

  it('clears an estimate when it is explicitly set back to null', () => {
    const task = createTask(db, userOne, workspaceId, taskInput('Sized', { estimate: 5 }))
    expect(task.estimate).toBe(5)
    expect(updateTask(db, userOne, workspaceId, task.id, { estimate: null }).estimate).toBeNull()
  })
})
