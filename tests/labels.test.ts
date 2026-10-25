import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { KobiDatabase } from '../server/db'
import { taskLabels, users, workspaceMembers } from '../server/db/schema'
import {
  attachTaskLabel,
  createLabel,
  createLabelGroup,
  deleteLabel,
  deleteLabelGroup,
  detachTaskLabel,
  getLabel,
  listLabels,
  updateLabel,
} from '../server/services/labels'
import { createProject } from '../server/services/projects'
import { createTask, deleteTask, getTask, listTasks, updateTask } from '../server/services/tasks'
import { initializeDatabase } from '../server/utils/database'
import { createWorkspaceForUser } from './workspace-fixtures'

const userOne = '11111111-1111-4111-8111-111111111111'
const userTwo = '22222222-2222-4222-8222-222222222222'

const taskInput = (title: string, overrides: Record<string, unknown> = {}) => ({
  title,
  description: '',
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

describe('label service', () => {
  let sqlite: Database.Database
  let db: KobiDatabase
  let workspaceId: string
  let otherWorkspaceId: string

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

  it('keeps exactly one label from a group attached when a grouped label is swapped', () => {
    const group = createLabelGroup(db, userOne, workspaceId, { name: 'Type' })
    const bug = createLabel(db, userOne, workspaceId, {
      name: 'bug', color: 'red', description: '', groupId: group.id,
    })
    const feature = createLabel(db, userOne, workspaceId, {
      name: 'feature', color: 'blue', description: '', groupId: group.id,
    })
    const task = createTask(db, userOne, workspaceId, taskInput('Grouped'))

    attachTaskLabel(db, userOne, workspaceId, task.id, bug.id)
    expect(getTask(db, userOne, workspaceId, task.id).labels.map(label => label.name)).toEqual(['bug'])

    attachTaskLabel(db, userOne, workspaceId, task.id, feature.id)
    const after = getTask(db, userOne, workspaceId, task.id)
    expect(after.labels.map(label => label.name)).toEqual(['feature'])
    expect(after.labels).toHaveLength(1)
  })

  it('treats ungrouped labels as multi-select', () => {
    const urgent = createLabel(db, userOne, workspaceId, { name: 'urgent', color: 'red', description: '', groupId: null })
    const research = createLabel(db, userOne, workspaceId, { name: 'research', color: 'teal', description: '', groupId: null })
    const task = createTask(db, userOne, workspaceId, taskInput('Ungrouped'))

    attachTaskLabel(db, userOne, workspaceId, task.id, urgent.id)
    attachTaskLabel(db, userOne, workspaceId, task.id, research.id)

    expect(getTask(db, userOne, workspaceId, task.id).labels.map(label => label.name))
      .toEqual(['research', 'urgent'])
  })

  it('collapses same-group siblings to the last one when labels are set wholesale', () => {
    const group = createLabelGroup(db, userOne, workspaceId, { name: 'Type' })
    const bug = createLabel(db, userOne, workspaceId, { name: 'bug', color: 'red', description: '', groupId: group.id })
    const chore = createLabel(db, userOne, workspaceId, { name: 'chore', color: 'slate', description: '', groupId: group.id })
    const urgent = createLabel(db, userOne, workspaceId, { name: 'urgent', color: 'amber', description: '', groupId: null })

    const task = createTask(db, userOne, workspaceId, taskInput('Wholesale', {
      labelIds: [bug.id, chore.id, urgent.id],
    }))

    expect(task.labels.map(label => label.name).sort()).toEqual(['chore', 'urgent'])
  })

  it('attaching the same label twice is idempotent', () => {
    const label = createLabel(db, userOne, workspaceId, { name: 'urgent', color: 'red', description: '', groupId: null })
    const task = createTask(db, userOne, workspaceId, taskInput('Repeat'))

    attachTaskLabel(db, userOne, workspaceId, task.id, label.id)
    attachTaskLabel(db, userOne, workspaceId, task.id, label.id)

    expect(getTask(db, userOne, workspaceId, task.id).labels).toHaveLength(1)
  })

  it('returns only tasks carrying every requested label', () => {
    const urgent = createLabel(db, userOne, workspaceId, { name: 'urgent', color: 'red', description: '', groupId: null })
    const backend = createLabel(db, userOne, workspaceId, { name: 'backend', color: 'blue', description: '', groupId: null })

    const both = createTask(db, userOne, workspaceId, taskInput('Both', { labelIds: [urgent.id, backend.id] }))
    createTask(db, userOne, workspaceId, taskInput('Only urgent', { labelIds: [urgent.id] }))
    createTask(db, userOne, workspaceId, taskInput('Unlabelled'))

    const filtered = listTasks(db, userOne, workspaceId, {
      scope: 'all', labelIds: [urgent.id, backend.id], includeCompleted: true,
    })
    expect(filtered.map(task => task.id)).toEqual([both.id])

    const single = listTasks(db, userOne, workspaceId, {
      scope: 'all', labelIds: [urgent.id], includeCompleted: true,
    })
    expect(single.map(task => task.title).sort()).toEqual(['Both', 'Only urgent'])
  })

  it('hides archived labels from the picker but keeps them on their tasks', () => {
    const label = createLabel(db, userOne, workspaceId, { name: 'legacy', color: 'slate', description: '', groupId: null })
    const task = createTask(db, userOne, workspaceId, taskInput('Historical', { labelIds: [label.id] }))

    updateLabel(db, userOne, workspaceId, label.id, { archived: true })

    expect(listLabels(db, workspaceId).labels).toEqual([])
    expect(listLabels(db, workspaceId, { includeArchived: true }).labels.map(l => l.name)).toEqual(['legacy'])
    expect(getTask(db, userOne, workspaceId, task.id).labels.map(l => l.name)).toEqual(['legacy'])
  })

  it('unarchiving clears the marker rather than stamping a new one', () => {
    const label = createLabel(db, userOne, workspaceId, { name: 'seasonal', color: 'green', description: '', groupId: null })
    const archived = updateLabel(db, userOne, workspaceId, label.id, { archived: true })
    expect(archived.archivedAt).not.toBeNull()
    // Re-archiving must not move the timestamp, and unarchiving must clear it.
    expect(updateLabel(db, userOne, workspaceId, label.id, { archived: true }).archivedAt).toBe(archived.archivedAt)
    expect(updateLabel(db, userOne, workspaceId, label.id, { archived: false }).archivedAt).toBeNull()
  })

  it('reports another workspace label as missing rather than forbidden', () => {
    const mine = createLabel(db, userOne, workspaceId, { name: 'mine', color: 'red', description: '', groupId: null })
    const theirs = createLabel(db, userTwo, otherWorkspaceId, { name: 'theirs', color: 'blue', description: '', groupId: null })

    expect(() => getLabel(db, otherWorkspaceId, mine.id))
      .toThrowError(expect.objectContaining({ statusCode: 404 }))
    expect(() => updateLabel(db, userTwo, otherWorkspaceId, mine.id, { name: 'stolen' }))
      .toThrowError(expect.objectContaining({ statusCode: 404 }))

    // Nor can a label be attached across the workspace boundary.
    const task = createTask(db, userOne, workspaceId, taskInput('Mine'))
    expect(() => attachTaskLabel(db, userOne, workspaceId, task.id, theirs.id))
      .toThrowError(expect.objectContaining({ statusCode: 404 }))
    expect(() => updateTask(db, userOne, workspaceId, task.id, { labelIds: [theirs.id] }))
      .toThrowError(expect.objectContaining({ statusCode: 404 }))
  })

  it('does not let another workspace see labels through a task list', () => {
    const label = createLabel(db, userOne, workspaceId, { name: 'secret', color: 'red', description: '', groupId: null })
    createTask(db, userOne, workspaceId, taskInput('Labelled', { labelIds: [label.id] }))

    expect(listLabels(db, otherWorkspaceId).labels).toEqual([])
    expect(listTasks(db, userTwo, otherWorkspaceId, { scope: 'all', includeCompleted: true })).toEqual([])
  })

  // Two members of ONE workspace: the cross-workspace tests above cannot catch this, and a
  // product with invites has this case in production.
  it('does not let a second member label another member’s inbox task', () => {
    db.insert(workspaceMembers)
      .values({ workspaceId, userId: userTwo, role: 'member', joinedAt: '2026-01-02T00:00:00.000Z' })
      .run()
    const label = createLabel(db, userOne, workspaceId, { name: 'private', color: 'red', description: '', groupId: null })
    // No project, so the task is private to the member who created it.
    const task = createTask(db, userOne, workspaceId, taskInput('Therapy appointment'))

    expect(() => attachTaskLabel(db, userTwo, workspaceId, task.id, label.id))
      .toThrowError(expect.objectContaining({ statusCode: 404 }))
    expect(db.select().from(taskLabels).where(eq(taskLabels.taskId, task.id)).all()).toEqual([])

    // Nor may the second member strip a label the owner applied.
    attachTaskLabel(db, userOne, workspaceId, task.id, label.id)
    expect(() => detachTaskLabel(db, userTwo, workspaceId, task.id, label.id))
      .toThrowError(expect.objectContaining({ statusCode: 404 }))
    expect(db.select().from(taskLabels).where(eq(taskLabels.taskId, task.id)).all()).toHaveLength(1)
  })

  it('lets a second member label a task that belongs to a project', () => {
    db.insert(workspaceMembers)
      .values({ workspaceId, userId: userTwo, role: 'member', joinedAt: '2026-01-02T00:00:00.000Z' })
      .run()
    const label = createLabel(db, userOne, workspaceId, { name: 'shared', color: 'teal', description: '', groupId: null })
    const project = createProject(db, userOne, workspaceId, {
      title: 'Shared work', description: '', goalId: null, targetDate: null,
    })
    const task = createTask(db, userOne, workspaceId, taskInput('Shared', { projectId: project.id }))

    attachTaskLabel(db, userTwo, workspaceId, task.id, label.id)

    expect(getTask(db, userTwo, workspaceId, task.id).labels.map(l => l.name)).toEqual(['shared'])
  })

  it('collapses siblings when an attached label is moved into a group', () => {
    const group = createLabelGroup(db, userOne, workspaceId, { name: 'Type' })
    const bug = createLabel(db, userOne, workspaceId, { name: 'bug', color: 'red', description: '', groupId: group.id })
    const chore = createLabel(db, userOne, workspaceId, { name: 'chore', color: 'slate', description: '', groupId: null })
    const task = createTask(db, userOne, workspaceId, taskInput('Regrouped', { labelIds: [bug.id, chore.id] }))
    expect(task.labels).toHaveLength(2)

    // Moving `chore` into Type makes it a sibling of `bug`, and a group is single-select.
    updateLabel(db, userOne, workspaceId, chore.id, { groupId: group.id })

    const after = getTask(db, userOne, workspaceId, task.id)
    expect(after.labels).toHaveLength(1)
    expect(after.labels.map(l => l.groupName)).toEqual(['Type'])
  })

  it('leaves ungrouped labels alone when another label is regrouped', () => {
    const group = createLabelGroup(db, userOne, workspaceId, { name: 'Type' })
    const bug = createLabel(db, userOne, workspaceId, { name: 'bug', color: 'red', description: '', groupId: group.id })
    const chore = createLabel(db, userOne, workspaceId, { name: 'chore', color: 'slate', description: '', groupId: null })
    const urgent = createLabel(db, userOne, workspaceId, { name: 'urgent', color: 'amber', description: '', groupId: null })
    const task = createTask(db, userOne, workspaceId, taskInput('Mixed', {
      labelIds: [bug.id, chore.id, urgent.id],
    }))
    expect(task.labels).toHaveLength(3)

    updateLabel(db, userOne, workspaceId, chore.id, { groupId: group.id })

    const names = getTask(db, userOne, workspaceId, task.id).labels.map(l => l.name)
    expect(names).toContain('urgent')
    expect(names).toHaveLength(2)
  })

  it('rejects a duplicate label name in the same workspace, case-insensitively', () => {
    createLabel(db, userOne, workspaceId, { name: 'Urgent', color: 'red', description: '', groupId: null })

    expect(() => createLabel(db, userOne, workspaceId, { name: 'urgent', color: 'blue', description: '', groupId: null }))
      .toThrowError(expect.objectContaining({ statusCode: 409 }))
    // The same name is free in another workspace: labels are workspace-scoped.
    expect(createLabel(db, userTwo, otherWorkspaceId, { name: 'Urgent', color: 'red', description: '', groupId: null }).name)
      .toBe('Urgent')
  })

  it('removes task_labels rows when the task is deleted', () => {
    const label = createLabel(db, userOne, workspaceId, { name: 'doomed', color: 'red', description: '', groupId: null })
    const task = createTask(db, userOne, workspaceId, taskInput('Doomed', { labelIds: [label.id] }))
    expect(db.select().from(taskLabels).where(eq(taskLabels.taskId, task.id)).all()).toHaveLength(1)

    deleteTask(db, userOne, workspaceId, task.id)

    expect(db.select().from(taskLabels).where(eq(taskLabels.taskId, task.id)).all()).toEqual([])
    // The label itself survives its tasks.
    expect(listLabels(db, workspaceId).labels.map(l => l.name)).toEqual(['doomed'])
  })

  it('removes task_labels rows when the label is deleted', () => {
    const label = createLabel(db, userOne, workspaceId, { name: 'temporary', color: 'red', description: '', groupId: null })
    const task = createTask(db, userOne, workspaceId, taskInput('Keeps living', { labelIds: [label.id] }))

    deleteLabel(db, userOne, workspaceId, label.id)

    expect(db.select().from(taskLabels).where(eq(taskLabels.taskId, task.id)).all()).toEqual([])
    // The task itself is untouched by losing a label.
    expect(getTask(db, userOne, workspaceId, task.id).labels).toEqual([])
  })

  it('renames in place and detaches without touching the task', () => {
    const label = createLabel(db, userOne, workspaceId, { name: 'temporary', color: 'red', description: '', groupId: null })
    const task = createTask(db, userOne, workspaceId, taskInput('Keeps living', { labelIds: [label.id] }))

    updateLabel(db, userOne, workspaceId, label.id, { name: 'renamed' })
    expect(getTask(db, userOne, workspaceId, task.id).labels.map(l => l.name)).toEqual(['renamed'])

    detachTaskLabel(db, userOne, workspaceId, task.id, label.id)
    expect(getTask(db, userOne, workspaceId, task.id).labels).toEqual([])
    // Detaching is not deleting: the label stays available in the picker.
    expect(listLabels(db, workspaceId).labels.map(l => l.name)).toEqual(['renamed'])
  })

  it('leaves a deleted group’s labels attached as ungrouped labels', () => {
    const group = createLabelGroup(db, userOne, workspaceId, { name: 'Type' })
    const bug = createLabel(db, userOne, workspaceId, { name: 'bug', color: 'red', description: '', groupId: group.id })
    const task = createTask(db, userOne, workspaceId, taskInput('Survivor', { labelIds: [bug.id] }))

    deleteLabelGroup(db, userOne, workspaceId, group.id)

    const labels = getTask(db, userOne, workspaceId, task.id).labels
    expect(labels.map(label => label.name)).toEqual(['bug'])
    expect(labels[0]?.groupId).toBeNull()
  })

  it('hydrates a whole list without dropping any task’s labels', () => {
    const urgent = createLabel(db, userOne, workspaceId, { name: 'urgent', color: 'red', description: '', groupId: null })
    const backend = createLabel(db, userOne, workspaceId, { name: 'backend', color: 'blue', description: '', groupId: null })
    createTask(db, userOne, workspaceId, taskInput('A', { labelIds: [urgent.id] }))
    createTask(db, userOne, workspaceId, taskInput('B', { labelIds: [urgent.id, backend.id] }))
    createTask(db, userOne, workspaceId, taskInput('C'))

    const byTitle = new Map(
      listTasks(db, userOne, workspaceId, { scope: 'all', includeCompleted: true })
        .map(task => [task.title, task.labels.map(label => label.name).sort()]),
    )
    expect(byTitle.get('A')).toEqual(['urgent'])
    expect(byTitle.get('B')).toEqual(['backend', 'urgent'])
    expect(byTitle.get('C')).toEqual([])
  })

  it('rejects a group from another workspace when creating a label', () => {
    const group = createLabelGroup(db, userTwo, otherWorkspaceId, { name: 'Theirs' })

    expect(() => createLabel(db, userOne, workspaceId, {
      name: 'borrowed', color: 'red', description: '', groupId: group.id,
    })).toThrowError(expect.objectContaining({ statusCode: 422 }))
  })
})
