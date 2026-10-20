import { and, asc, eq, gt, isNotNull, isNull, ne, or, sql } from 'drizzle-orm'
import { createError } from 'h3'
import type { CreateTaskInput, TaskQuery, UpdateTaskInput } from '#shared/schemas/task'
import type { Task } from '#shared/types/domain'
import type { KobiDatabase, KobiDb } from '~~/server/db'
import { milestones, projects, taskDaySelections, tasks, users, workspaceMembers } from '~~/server/db/schema'
import type { TaskRow } from '~~/server/types/database'
import { nextRecurringDate } from '#shared/utils/recurrence'
import { nowIso, todayIso } from '~~/server/utils/time'
import { workspaceIdForUser } from '~~/server/utils/workspace'

const taskSelection = {
  id: tasks.id,
  user_id: tasks.userId,
  assignee_id: tasks.assigneeId,
  assignee_name: users.name,
  assignee_email: users.email,
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
  selected_for_today: sql<boolean>`${taskDaySelections.taskId} is not null`,
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
  selectedForToday: Boolean(row.selected_for_today),
  assigneeId: row.assignee_id,
  assigneeName: row.assignee_name,
  assigneeEmail: row.assignee_email,
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

const assertProject = (db: KobiDb, workspaceId: string, projectId: string | null) => {
  if (!projectId) return
  const project = db.select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)))
    .get()
  if (!project) throw createError({ status: 422, statusText: 'Project is not available' })
}

const assertMilestone = (
  db: KobiDb,
  workspaceId: string,
  milestoneId: string | null,
  projectId: string | null,
) => {
  if (!milestoneId) return
  const milestone = db.select({ project_id: milestones.projectId })
    .from(milestones)
    .where(and(eq(milestones.id, milestoneId), eq(milestones.workspaceId, workspaceId)))
    .get()
  if (!milestone || milestone.project_id !== projectId) {
    throw createError({ status: 422, statusText: 'Milestone does not belong to the project' })
  }
}

const assertParent = (db: KobiDb, userId: string, workspaceId: string, parentId: string | null) => {
  if (!parentId) return
  const parent = db.select({ id: tasks.id })
    .from(tasks)
    .where(and(
      eq(tasks.id, parentId),
      eq(tasks.workspaceId, workspaceId),
      or(isNotNull(tasks.projectId), eq(tasks.userId, userId)),
    ))
    .get()
  if (!parent) throw createError({ status: 422, statusText: 'Parent task is not available' })
}

const assertAssignee = (db: KobiDb, workspaceId: string, assigneeId: string | null) => {
  if (!assigneeId) return
  const member = db.select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, assigneeId)))
    .get()
  if (!member) throw createError({ status: 422, statusText: 'Assignee is not a workspace member' })
}

const setDaySelection = (db: KobiDb, userId: string, taskId: string, selected: boolean) => {
  if (selected) {
    db.insert(taskDaySelections).values({ userId, taskId, createdAt: nowIso() }).onConflictDoNothing().run()
  } else {
    db.delete(taskDaySelections)
      .where(and(eq(taskDaySelections.userId, userId), eq(taskDaySelections.taskId, taskId)))
      .run()
  }
}

export const getTask = (
  db: KobiDb,
  userId: string,
  workspaceIdOrTaskId: string,
  maybeTaskId?: string,
) => {
  const workspaceId = workspaceIdForUser(db, userId, maybeTaskId ? workspaceIdOrTaskId : undefined)
  const taskId = maybeTaskId ?? workspaceIdOrTaskId
  const row = db.select(taskSelection)
    .from(tasks)
    .leftJoin(users, eq(users.id, tasks.assigneeId))
    .leftJoin(projects, and(eq(projects.id, tasks.projectId), eq(projects.workspaceId, tasks.workspaceId)))
    .leftJoin(milestones, and(eq(milestones.id, tasks.milestoneId), eq(milestones.workspaceId, tasks.workspaceId)))
    .leftJoin(taskDaySelections, and(eq(taskDaySelections.taskId, tasks.id), eq(taskDaySelections.userId, userId)))
    .where(and(
      eq(tasks.id, taskId),
      eq(tasks.workspaceId, workspaceId),
      or(isNotNull(tasks.projectId), eq(tasks.userId, userId)),
    ))
    .get() as TaskRow | undefined
  if (!row) return notFound()
  return mapTask(row)
}

export const listTasks = (
  db: KobiDb,
  userId: string,
  workspaceIdOrQuery: string | TaskQuery,
  maybeQuery?: TaskQuery,
): Task[] => {
  const workspaceId = workspaceIdForUser(db, userId, typeof workspaceIdOrQuery === 'string' ? workspaceIdOrQuery : undefined)
  const query = typeof workspaceIdOrQuery === 'string' ? maybeQuery : workspaceIdOrQuery
  if (!query) throw new Error('Task query is required')
  const conditions = [
    eq(tasks.workspaceId, workspaceId),
    or(isNotNull(tasks.projectId), eq(tasks.userId, userId))!,
  ]
  const today = todayIso()

  if (query.projectId) {
    conditions.push(eq(tasks.projectId, query.projectId))
  }
  if (query.status) {
    conditions.push(eq(tasks.status, query.status))
  }
  if (query.assignee === 'me') conditions.push(eq(tasks.assigneeId, userId))
  if (query.assignee === 'unassigned') conditions.push(isNull(tasks.assigneeId))
  if (query.scope === 'inbox') {
    conditions.push(isNull(tasks.projectId), eq(tasks.userId, userId), ne(tasks.status, 'done'))
  } else if (query.scope === 'today') {
    conditions.push(ne(tasks.status, 'done'))
    conditions.push(or(
      eq(tasks.dueDate, today),
      eq(tasks.scheduledFor, today),
      eq(tasks.assigneeId, userId),
      isNotNull(taskDaySelections.taskId),
      and(isNull(tasks.projectId), eq(tasks.userId, userId)),
    )!)
  } else if (query.scope === 'upcoming') {
    conditions.push(ne(tasks.status, 'done'), gt(tasks.dueDate, today))
    conditions.push(or(eq(tasks.assigneeId, userId), and(isNull(tasks.projectId), eq(tasks.userId, userId)))!)
  }

  const rows = db.select(taskSelection)
    .from(tasks)
    .leftJoin(users, eq(users.id, tasks.assigneeId))
    .leftJoin(projects, and(eq(projects.id, tasks.projectId), eq(projects.workspaceId, tasks.workspaceId)))
    .leftJoin(milestones, and(eq(milestones.id, tasks.milestoneId), eq(milestones.workspaceId, tasks.workspaceId)))
    .leftJoin(taskDaySelections, and(eq(taskDaySelections.taskId, tasks.id), eq(taskDaySelections.userId, userId)))
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
  workspaceIdOrInput: string | CreateTaskInput,
  maybeInput?: CreateTaskInput,
) => {
  const workspaceId = workspaceIdForUser(db, userId, typeof workspaceIdOrInput === 'string' ? workspaceIdOrInput : undefined)
  const input = typeof workspaceIdOrInput === 'string' ? maybeInput : workspaceIdOrInput
  if (!input) throw new Error('Task input is required')
  assertProject(db, workspaceId, input.projectId)
  assertMilestone(db, workspaceId, input.milestoneId, input.projectId)
  const assigneeId = input.projectId === null
    ? userId
    : input.assigneeId === undefined ? userId : input.assigneeId
  assertAssignee(db, workspaceId, assigneeId)
  if (input.recurrence !== 'none' && !input.dueDate) {
    throw createError({ status: 422, statusText: 'Recurring tasks need a due date' })
  }
  if (input.recurrence !== 'none' && input.status === 'done') {
    throw createError({ status: 422, statusText: 'Recurring tasks must start open' })
  }
  assertParent(db, userId, workspaceId, input.parentId)

  const id = crypto.randomUUID()
  const now = nowIso()
  const projectCondition = input.projectId === null
    ? and(isNull(tasks.projectId), eq(tasks.userId, userId))!
    : eq(tasks.projectId, input.projectId)
  const positionRow = db.select({ position: sql<number>`coalesce(max(${tasks.position}), -1) + 1` })
    .from(tasks)
    .where(and(eq(tasks.workspaceId, workspaceId), projectCondition))
    .get()

  db.insert(tasks).values({
    id,
    userId,
    workspaceId,
    assigneeId,
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
    completedAt: input.status === 'done' ? now : null,
    position: positionRow?.position ?? 0,
    createdAt: now,
    updatedAt: now,
  }).run()
  setDaySelection(db, userId, id, input.selectedForToday)
  return getTask(db, userId, workspaceId, id)
}

export const updateTask = (
  db: KobiDatabase,
  userId: string,
  workspaceIdOrTaskId: string,
  taskIdOrInput: string | UpdateTaskInput,
  maybeInput?: UpdateTaskInput,
) => {
  const legacy = typeof taskIdOrInput !== 'string'
  const workspaceId = workspaceIdForUser(db, userId, legacy ? undefined : workspaceIdOrTaskId)
  const taskId = legacy ? workspaceIdOrTaskId : taskIdOrInput
  const input = legacy ? taskIdOrInput : maybeInput
  if (!input || typeof input === 'string') throw new Error('Task input is required')
  const current = getTask(db, userId, workspaceId, taskId)
  const projectId = input.projectId === undefined ? current.projectId : input.projectId
  const milestoneId = input.milestoneId === undefined ? current.milestoneId : input.milestoneId
  const parentId = input.parentId === undefined ? current.parentId : input.parentId
  const assigneeId = projectId === null
    ? userId
    : input.assigneeId === undefined ? current.assigneeId : input.assigneeId
  assertProject(db, workspaceId, projectId)
  assertMilestone(db, workspaceId, milestoneId, projectId)
  assertParent(db, userId, workspaceId, parentId)
  assertAssignee(db, workspaceId, assigneeId)

  const valuesFor = (base: Task) => {
    const values = {
      projectId: input.projectId === undefined ? base.projectId : input.projectId,
      milestoneId: input.milestoneId === undefined ? base.milestoneId : input.milestoneId,
      parentId: input.parentId === undefined ? base.parentId : input.parentId,
      assigneeId,
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
    const { selectedForToday, ...taskValues } = values
    database.update(tasks)
      .set({ ...taskValues, updatedAt })
      .where(and(
        eq(tasks.id, taskId),
        eq(tasks.workspaceId, workspaceId),
        or(isNotNull(tasks.projectId), eq(tasks.userId, userId)),
      ))
      .run()
    setDaySelection(database, userId, taskId, selectedForToday)
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
      const latest = getTask(tx, userId, workspaceId, taskId)
      const latestValues = valuesFor(latest)
      assertProject(tx, workspaceId, latestValues.projectId)
      assertMilestone(tx, workspaceId, latestValues.milestoneId, latestValues.projectId)
      assertParent(tx, userId, workspaceId, latestValues.parentId)
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
        ? and(isNull(tasks.projectId), eq(tasks.userId, userId))!
        : eq(tasks.projectId, latestValues.projectId)
      const positionRow = tx.select({ position: sql<number>`coalesce(max(${tasks.position}), -1) + 1` })
        .from(tasks)
        .where(and(eq(tasks.workspaceId, workspaceId), projectCondition))
        .get()
      tx.insert(tasks).values({
        id: crypto.randomUUID(),
        userId,
        workspaceId,
        assigneeId: latestValues.assigneeId,
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
        completedAt: null,
        position: positionRow?.position ?? 0,
        createdAt: updatedAt,
        updatedAt,
      }).run()
    })
  } else {
    update(db, values, nowIso())
  }
  return getTask(db, userId, workspaceId, taskId)
}

export const deleteTask = (db: KobiDb, userId: string, workspaceIdOrTaskId: string, maybeTaskId?: string) => {
  const workspaceId = workspaceIdForUser(db, userId, maybeTaskId ? workspaceIdOrTaskId : undefined)
  const taskId = maybeTaskId ?? workspaceIdOrTaskId
  const result = db.delete(tasks)
    .where(and(
      eq(tasks.id, taskId),
      eq(tasks.workspaceId, workspaceId),
      or(isNotNull(tasks.projectId), eq(tasks.userId, userId)),
    ))
    .run()
  if (!result.changes) notFound()
}
