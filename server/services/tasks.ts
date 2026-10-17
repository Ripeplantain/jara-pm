import { and, asc, eq, gt, isNull, ne, or, sql } from 'drizzle-orm'
import type { CreateTaskInput, TaskQuery, UpdateTaskInput } from '#shared/schemas/task'
import type { Task } from '#shared/types/domain'
import type { KobiDb } from '~~/server/db'
import { milestones, projects, tasks } from '~~/server/db/schema'
import type { TaskRow } from '~~/server/types/database'
import { nowIso, todayIso } from '~~/server/utils/time'

const taskSelection = {
  id: tasks.id,
  user_id: tasks.userId,
  project_id: tasks.projectId,
  project_title: projects.title,
  milestone_id: tasks.milestoneId,
  milestone_title: milestones.title,
  parent_id: tasks.parentId,
  title: tasks.title,
  description: tasks.description,
  status: tasks.status,
  priority: tasks.priority,
  due_date: tasks.dueDate,
  scheduled_for: tasks.scheduledFor,
  selected_for_today: tasks.selectedForToday,
  completed_at: tasks.completedAt,
  position: tasks.position,
  created_at: tasks.createdAt,
  updated_at: tasks.updatedAt,
}

const mapTask = (row: TaskRow): Task => ({
  id: row.id,
  title: row.title,
  description: row.description,
  status: row.status,
  priority: row.priority,
  dueDate: row.due_date,
  scheduledFor: row.scheduled_for,
  selectedForToday: row.selected_for_today,
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

const assertProject = (db: KobiDb, userId: string, projectId: string | null) => {
  if (!projectId) return
  const project = db.select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .get()
  if (!project) throw createError({ status: 422, statusText: 'Project is not available' })
}

const assertMilestone = (
  db: KobiDb,
  userId: string,
  milestoneId: string | null,
  projectId: string | null,
) => {
  if (!milestoneId) return
  const milestone = db.select({ project_id: milestones.projectId })
    .from(milestones)
    .where(and(eq(milestones.id, milestoneId), eq(milestones.userId, userId)))
    .get()
  if (!milestone || milestone.project_id !== projectId) {
    throw createError({ status: 422, statusText: 'Milestone does not belong to the project' })
  }
}

export const getTask = (db: KobiDb, userId: string, taskId: string) => {
  const row = db.select(taskSelection)
    .from(tasks)
    .leftJoin(projects, eq(projects.id, tasks.projectId))
    .leftJoin(milestones, eq(milestones.id, tasks.milestoneId))
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
    .get() as TaskRow | undefined
  if (!row) return notFound()
  return mapTask(row)
}

export const listTasks = (db: KobiDb, userId: string, query: TaskQuery): Task[] => {
  const conditions = [eq(tasks.userId, userId)]
  const today = todayIso()

  if (query.projectId) {
    conditions.push(eq(tasks.projectId, query.projectId))
  }
  if (query.status) {
    conditions.push(eq(tasks.status, query.status))
  }
  if (query.scope === 'inbox') {
    conditions.push(isNull(tasks.projectId), ne(tasks.status, 'done'))
  } else if (query.scope === 'today') {
    conditions.push(ne(tasks.status, 'done'))
    conditions.push(or(
      eq(tasks.dueDate, today),
      eq(tasks.scheduledFor, today),
      eq(tasks.selectedForToday, true),
    )!)
  } else if (query.scope === 'upcoming') {
    conditions.push(ne(tasks.status, 'done'), gt(tasks.dueDate, today))
  }

  const rows = db.select(taskSelection)
    .from(tasks)
    .leftJoin(projects, eq(projects.id, tasks.projectId))
    .leftJoin(milestones, eq(milestones.id, tasks.milestoneId))
    .where(and(...conditions))
    .orderBy(
      sql`case ${tasks.priority} when 'high' then 0 when 'medium' then 1 when 'low' then 2 else 3 end`,
      sql`coalesce(${tasks.dueDate}, '9999-12-31')`,
      asc(tasks.position),
      asc(tasks.createdAt),
    )
    .all() as TaskRow[]
  return rows.map(mapTask)
}

export const createTask = (
  db: KobiDb,
  userId: string,
  input: CreateTaskInput,
) => {
  assertProject(db, userId, input.projectId)
  assertMilestone(db, userId, input.milestoneId, input.projectId)
  if (input.parentId) {
    const parent = db.select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.id, input.parentId), eq(tasks.userId, userId)))
      .get()
    if (!parent) throw createError({ status: 422, statusText: 'Parent task is not available' })
  }

  const id = crypto.randomUUID()
  const now = nowIso()
  const projectCondition = input.projectId === null
    ? isNull(tasks.projectId)
    : eq(tasks.projectId, input.projectId)
  const positionRow = db.select({ position: sql<number>`coalesce(max(${tasks.position}), -1) + 1` })
    .from(tasks)
    .where(and(eq(tasks.userId, userId), projectCondition))
    .get()

  db.insert(tasks).values({
    id,
    userId,
    projectId: input.projectId,
    milestoneId: input.milestoneId,
    parentId: input.parentId,
    title: input.title,
    description: input.description,
    status: input.status,
    priority: input.priority,
    dueDate: input.dueDate,
    scheduledFor: input.scheduledFor,
    selectedForToday: input.selectedForToday,
    completedAt: input.status === 'done' ? now : null,
    position: positionRow?.position ?? 0,
    createdAt: now,
    updatedAt: now,
  }).run()
  return getTask(db, userId, id)
}

export const updateTask = (
  db: KobiDb,
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

  db.update(tasks)
    .set({
      projectId,
      milestoneId,
      parentId: input.parentId === undefined ? current.parentId : input.parentId,
      title: input.title ?? current.title,
      description: input.description ?? current.description,
      status,
      priority: input.priority ?? current.priority,
      dueDate: input.dueDate === undefined ? current.dueDate : input.dueDate,
      scheduledFor: input.scheduledFor === undefined ? current.scheduledFor : input.scheduledFor,
      selectedForToday: input.selectedForToday === undefined
        ? current.selectedForToday
        : input.selectedForToday,
      completedAt,
      updatedAt: nowIso(),
    })
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
    .run()
  return getTask(db, userId, taskId)
}

export const deleteTask = (db: KobiDb, userId: string, taskId: string) => {
  const result = db.delete(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
    .run()
  if (!result.changes) notFound()
}
