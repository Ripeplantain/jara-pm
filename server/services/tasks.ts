import { and, asc, eq, gt, isNull, ne, or, sql } from 'drizzle-orm'
import { createError } from 'h3'
import type { CreateTaskInput, TaskQuery, UpdateTaskInput } from '#shared/schemas/task'
import type { Task } from '#shared/types/domain'
import type { KobiDatabase, KobiDb } from '~~/server/db'
import { milestones, projects, tasks } from '~~/server/db/schema'
import type { TaskRow } from '~~/server/types/database'
import { nextRecurringDate } from '#shared/utils/recurrence'
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
  recurrence: tasks.recurrence,
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
  recurrence: row.recurrence,
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

const assertParent = (db: KobiDb, userId: string, parentId: string | null) => {
  if (!parentId) return
  const parent = db.select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, parentId), eq(tasks.userId, userId)))
    .get()
  if (!parent) throw createError({ status: 422, statusText: 'Parent task is not available' })
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
  if (input.recurrence !== 'none' && !input.dueDate) {
    throw createError({ status: 422, statusText: 'Recurring tasks need a due date' })
  }
  if (input.recurrence !== 'none' && input.status === 'done') {
    throw createError({ status: 422, statusText: 'Recurring tasks must start open' })
  }
  assertParent(db, userId, input.parentId)

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
    recurrence: input.recurrence,
    selectedForToday: input.selectedForToday,
    completedAt: input.status === 'done' ? now : null,
    position: positionRow?.position ?? 0,
    createdAt: now,
    updatedAt: now,
  }).run()
  return getTask(db, userId, id)
}

export const updateTask = (
  db: KobiDatabase,
  userId: string,
  taskId: string,
  input: UpdateTaskInput,
) => {
  const current = getTask(db, userId, taskId)
  const projectId = input.projectId === undefined ? current.projectId : input.projectId
  const milestoneId = input.milestoneId === undefined ? current.milestoneId : input.milestoneId
  const parentId = input.parentId === undefined ? current.parentId : input.parentId
  assertProject(db, userId, projectId)
  assertMilestone(db, userId, milestoneId, projectId)
  assertParent(db, userId, parentId)

  const valuesFor = (base: Task) => {
    const values = {
      projectId: input.projectId === undefined ? base.projectId : input.projectId,
      milestoneId: input.milestoneId === undefined ? base.milestoneId : input.milestoneId,
      parentId: input.parentId === undefined ? base.parentId : input.parentId,
      title: input.title ?? base.title,
      description: input.description ?? base.description,
      status: input.status ?? base.status,
      priority: input.priority ?? base.priority,
      dueDate: input.dueDate === undefined ? base.dueDate : input.dueDate,
      scheduledFor: input.scheduledFor === undefined ? base.scheduledFor : input.scheduledFor,
      recurrence: input.recurrence ?? base.recurrence,
      selectedForToday: input.selectedForToday === undefined
        ? base.selectedForToday
        : input.selectedForToday,
      completedAt: (input.status ?? base.status) === 'done'
        ? base.completedAt ?? nowIso()
        : null,
    }
    if (values.recurrence !== 'none' && !values.dueDate) {
      throw createError({ status: 422, statusText: 'Recurring tasks need a due date' })
    }
    return values
  }

  const update = (database: KobiDb, values: ReturnType<typeof valuesFor>, updatedAt: string) => {
    database.update(tasks)
      .set({ ...values, updatedAt })
      .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
      .run()
  }

  const values = valuesFor(current)
  if (current.status === 'done' && current.recurrence === 'none' && values.recurrence !== 'none') {
    throw createError({ status: 422, statusText: 'Completed tasks cannot start recurring' })
  }
  const shouldSchedule = values.status === 'done'
    && current.status !== 'done'
    && values.recurrence !== 'none'
    && values.dueDate !== null

  if (shouldSchedule) {
    db.transaction((tx) => {
      const latest = getTask(tx, userId, taskId)
      const latestValues = valuesFor(latest)
      assertProject(tx, userId, latestValues.projectId)
      assertMilestone(tx, userId, latestValues.milestoneId, latestValues.projectId)
      assertParent(tx, userId, latestValues.parentId)
      const updatedAt = nowIso()

      if (latest.status === 'done') {
        update(tx, latestValues, updatedAt)
        return
      }

      update(tx, latestValues, updatedAt)
      const nextDueDate = latestValues.dueDate && latestValues.recurrence !== 'none'
        ? nextRecurringDate(latestValues.dueDate, latestValues.recurrence, todayIso())
        : null
      if (!nextDueDate) return

      const projectCondition = latestValues.projectId === null
        ? isNull(tasks.projectId)
        : eq(tasks.projectId, latestValues.projectId)
      const positionRow = tx.select({ position: sql<number>`coalesce(max(${tasks.position}), -1) + 1` })
        .from(tasks)
        .where(and(eq(tasks.userId, userId), projectCondition))
        .get()
      tx.insert(tasks).values({
        id: crypto.randomUUID(),
        userId,
        projectId: latestValues.projectId,
        milestoneId: latestValues.milestoneId,
        parentId: null,
        title: latestValues.title,
        description: latestValues.description,
        status: 'todo',
        priority: latestValues.priority,
        dueDate: nextDueDate,
        scheduledFor: null,
        recurrence: latestValues.recurrence,
        selectedForToday: false,
        completedAt: null,
        position: positionRow?.position ?? 0,
        createdAt: updatedAt,
        updatedAt,
      }).run()
    })
  } else {
    update(db, values, nowIso())
  }
  return getTask(db, userId, taskId)
}

export const deleteTask = (db: KobiDb, userId: string, taskId: string) => {
  const result = db.delete(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
    .run()
  if (!result.changes) notFound()
}
