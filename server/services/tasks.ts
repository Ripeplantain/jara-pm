import type Database from 'better-sqlite3'
import type { CreateTaskInput, TaskQuery, UpdateTaskInput } from '#shared/schemas/task'
import type { Task } from '#shared/types/domain'
import type { TaskRow } from '~~/server/types/database'
import { nowIso, todayIso } from '~~/server/utils/time'

const TASK_SELECT = `
  SELECT tasks.*,
         projects.title AS project_title,
         milestones.title AS milestone_title
  FROM tasks
  LEFT JOIN projects ON projects.id = tasks.project_id
  LEFT JOIN milestones ON milestones.id = tasks.milestone_id
`

const mapTask = (row: TaskRow): Task => ({
  id: row.id,
  title: row.title,
  description: row.description,
  status: row.status,
  priority: row.priority,
  dueDate: row.due_date,
  scheduledFor: row.scheduled_for,
  selectedForToday: Boolean(row.selected_for_today),
  projectId: row.project_id,
  projectTitle: row.project_title,
  milestoneId: row.milestone_id,
  milestoneTitle: row.milestone_title,
  parentId: row.parent_id,
  completedAt: row.completed_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const notFound = () => {
  throw createError({ status: 404, statusText: 'Task not found' })
}

const assertProject = (db: Database.Database, userId: string, projectId: string | null) => {
  if (!projectId) return
  const project = db.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?')
    .get(projectId, userId)
  if (!project) throw createError({ status: 422, statusText: 'Project is not available' })
}

const assertMilestone = (
  db: Database.Database,
  userId: string,
  milestoneId: string | null,
  projectId: string | null,
) => {
  if (!milestoneId) return
  const milestone = db.prepare('SELECT project_id FROM milestones WHERE id = ? AND user_id = ?')
    .get(milestoneId, userId) as { project_id: string } | undefined
  if (!milestone || milestone.project_id !== projectId) {
    throw createError({ status: 422, statusText: 'Milestone does not belong to the project' })
  }
}

export const getTask = (db: Database.Database, userId: string, taskId: string) => {
  const row = db.prepare(`${TASK_SELECT} WHERE tasks.id = ? AND tasks.user_id = ?`)
    .get(taskId, userId) as TaskRow | undefined
  if (!row) return notFound()
  return mapTask(row)
}

export const listTasks = (db: Database.Database, userId: string, query: TaskQuery): Task[] => {
  const conditions = ['tasks.user_id = ?']
  const params: Array<string> = [userId]
  const today = todayIso()

  if (query.projectId) {
    conditions.push('tasks.project_id = ?')
    params.push(query.projectId)
  }
  if (query.status) {
    conditions.push('tasks.status = ?')
    params.push(query.status)
  }
  if (query.scope === 'inbox') {
    conditions.push('tasks.project_id IS NULL', "tasks.status != 'done'")
  } else if (query.scope === 'today') {
    conditions.push("tasks.status != 'done'")
    conditions.push('(tasks.due_date = ? OR tasks.scheduled_for = ? OR tasks.selected_for_today = 1)')
    params.push(today, today)
  } else if (query.scope === 'upcoming') {
    conditions.push("tasks.status != 'done'", 'tasks.due_date > ?')
    params.push(today)
  }

  const rows = db.prepare(`
    ${TASK_SELECT}
    WHERE ${conditions.join(' AND ')}
    ORDER BY
      CASE tasks.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3 END,
      COALESCE(tasks.due_date, '9999-12-31'),
      tasks.position,
      tasks.created_at
  `).all(...params) as TaskRow[]
  return rows.map(mapTask)
}

export const createTask = (
  db: Database.Database,
  userId: string,
  input: CreateTaskInput,
) => {
  assertProject(db, userId, input.projectId)
  assertMilestone(db, userId, input.milestoneId, input.projectId)
  if (input.parentId) {
    const parent = db.prepare('SELECT id FROM tasks WHERE id = ? AND user_id = ?')
      .get(input.parentId, userId)
    if (!parent) throw createError({ status: 422, statusText: 'Parent task is not available' })
  }

  const id = crypto.randomUUID()
  const now = nowIso()
  const positionRow = db.prepare(`
    SELECT COALESCE(MAX(position), -1) + 1 AS position
    FROM tasks
    WHERE user_id = ? AND project_id IS ?
  `).get(userId, input.projectId) as { position: number }

  db.prepare(`
    INSERT INTO tasks (
      id, user_id, project_id, milestone_id, parent_id, title, description, status,
      priority, due_date, scheduled_for, selected_for_today, completed_at, position,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, userId, input.projectId, input.milestoneId, input.parentId, input.title,
    input.description, input.status, input.priority, input.dueDate, input.scheduledFor,
    input.selectedForToday ? 1 : 0, input.status === 'done' ? now : null,
    positionRow.position, now, now,
  )
  return getTask(db, userId, id)
}

export const updateTask = (
  db: Database.Database,
  userId: string,
  taskId: string,
  input: UpdateTaskInput,
) => {
  const current = getTask(db, userId, taskId)
  const projectId = input.projectId === undefined ? current.projectId : input.projectId
  const milestoneId = input.milestoneId === undefined ? current.milestoneId : input.milestoneId
  assertProject(db, userId, projectId)
  assertMilestone(db, userId, milestoneId, projectId)

  const status = input.status ?? current.status
  const completedAt = status === 'done'
    ? current.completedAt ?? nowIso()
    : null

  db.prepare(`
    UPDATE tasks SET
      project_id = ?, milestone_id = ?, parent_id = ?, title = ?, description = ?,
      status = ?, priority = ?, due_date = ?, scheduled_for = ?, selected_for_today = ?,
      completed_at = ?, updated_at = ?
    WHERE id = ? AND user_id = ?
  `).run(
    projectId,
    milestoneId,
    input.parentId === undefined ? current.parentId : input.parentId,
    input.title ?? current.title,
    input.description ?? current.description,
    status,
    input.priority ?? current.priority,
    input.dueDate === undefined ? current.dueDate : input.dueDate,
    input.scheduledFor === undefined ? current.scheduledFor : input.scheduledFor,
    input.selectedForToday === undefined
      ? (current.selectedForToday ? 1 : 0)
      : (input.selectedForToday ? 1 : 0),
    completedAt,
    nowIso(),
    taskId,
    userId,
  )
  return getTask(db, userId, taskId)
}

export const deleteTask = (db: Database.Database, userId: string, taskId: string) => {
  const result = db.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?').run(taskId, userId)
  if (!result.changes) notFound()
}
