import { and, desc, eq, ne, sql } from 'drizzle-orm'
import { createError } from 'h3'
import type { CreateGoalInput, UpdateGoalInput } from '#shared/schemas/goal'
import type { Goal } from '#shared/types/domain'
import { calculateProgress } from '#shared/utils/progress'
import { goals, projects, tasks } from '~~/server/db/schema'
import type { KobiDb } from '~~/server/db'
import type { GoalRow } from '~~/server/types/database'
import { taskPointColumns, workspaceWeighsEstimates } from '~~/server/utils/task-points'
import { nowIso } from '~~/server/utils/time'

const mapGoal = (row: GoalRow): Goal => ({
  id: row.id,
  title: row.title,
  description: row.description,
  status: row.status,
  targetDate: row.target_date,
  projectCount: row.project_count,
  taskCount: row.task_count,
  completedTaskCount: row.completed_task_count,
  points: row.points,
  completedPoints: row.completed_points,
  progress: calculateProgress(row.completed_points, row.points),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const goalSelection = (weighted: boolean) => ({
  id: goals.id,
  user_id: goals.userId,
  title: goals.title,
  description: goals.description,
  status: goals.status,
  target_date: goals.targetDate,
  created_at: goals.createdAt,
  updated_at: goals.updatedAt,
  project_count: sql<number>`count(distinct ${projects.id})`,
  task_count: sql<number>`count(distinct ${tasks.id})`,
  completed_task_count: sql<number>`count(distinct case when ${tasks.status} = 'done' then ${tasks.id} end)`,
  ...taskPointColumns(weighted),
})

export const listGoals = (db: KobiDb, userId: string, workspaceId: string, includeArchived = false) => {
  const conditions = [eq(goals.workspaceId, workspaceId)]
  if (!includeArchived) conditions.push(ne(goals.status, 'archived'))
  const rows = db.select(goalSelection(workspaceWeighsEstimates(db, workspaceId)))
    .from(goals)
    .leftJoin(projects, and(
      eq(projects.goalId, goals.id),
      eq(projects.workspaceId, goals.workspaceId),
      ne(projects.status, 'archived'),
    ))
    .leftJoin(tasks, and(eq(tasks.projectId, projects.id), eq(tasks.workspaceId, projects.workspaceId)))
    .where(and(...conditions))
    .groupBy(goals.id)
    .orderBy(
      sql`case ${goals.status} when 'active' then 0 when 'completed' then 1 else 2 end`,
      sql`coalesce(${goals.targetDate}, '9999-12-31')`,
      desc(goals.createdAt),
    )
    .all() as GoalRow[]
  return rows.map(mapGoal)
}

export const getGoal = (db: KobiDb, userId: string, workspaceId: string, goalId: string) => {
  const row = db.select(goalSelection(workspaceWeighsEstimates(db, workspaceId)))
    .from(goals)
    .leftJoin(projects, and(
      eq(projects.goalId, goals.id),
      eq(projects.workspaceId, goals.workspaceId),
      ne(projects.status, 'archived'),
    ))
    .leftJoin(tasks, and(eq(tasks.projectId, projects.id), eq(tasks.workspaceId, projects.workspaceId)))
    .where(and(eq(goals.id, goalId), eq(goals.workspaceId, workspaceId)))
    .groupBy(goals.id)
    .get() as GoalRow | undefined
  if (!row) throw createError({ status: 404, statusText: 'Goal not found' })
  return mapGoal(row)
}

export const createGoal = (db: KobiDb, userId: string, workspaceId: string, input: CreateGoalInput) => {
  const id = crypto.randomUUID()
  const now = nowIso()
  db.insert(goals).values({
    id,
    userId,
    workspaceId,
    title: input.title,
    description: input.description,
    status: 'active',
    targetDate: input.targetDate,
    createdAt: now,
    updatedAt: now,
  }).run()
  return getGoal(db, userId, workspaceId, id)
}

export const updateGoal = (
  db: KobiDb,
  userId: string,
  workspaceId: string,
  goalId: string,
  input: UpdateGoalInput,
) => {
  const current = getGoal(db, userId, workspaceId, goalId)
  db.update(goals)
    .set({
      title: input.title ?? current.title,
      description: input.description ?? current.description,
      status: input.status ?? current.status,
      targetDate: input.targetDate === undefined ? current.targetDate : input.targetDate,
      updatedAt: nowIso(),
    })
    .where(and(eq(goals.id, goalId), eq(goals.workspaceId, workspaceId)))
    .run()
  return getGoal(db, userId, workspaceId, goalId)
}
