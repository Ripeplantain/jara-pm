import { and, asc, desc, eq, ne, sql } from 'drizzle-orm'
import type {
  CreateMilestoneInput,
  CreateProjectInput,
  UpdateMilestoneInput,
  UpdateProjectInput,
} from '#shared/schemas/project'
import type { Milestone, Project } from '#shared/types/domain'
import { calculateProgress } from '#shared/utils/progress'
import type { KobiDb } from '~~/server/db'
import { goals, milestones, projects, tasks } from '~~/server/db/schema'
import type { MilestoneRow, ProjectRow } from '~~/server/types/database'
import { nowIso } from '~~/server/utils/time'

const mapMilestone = (row: MilestoneRow): Milestone => ({
  id: row.id,
  projectId: row.project_id,
  title: row.title,
  description: row.description,
  targetDate: row.target_date,
  position: row.position,
  status: row.status,
  taskCount: row.task_count,
  completedTaskCount: row.completed_task_count,
  progress: calculateProgress(row.completed_task_count, row.task_count),
})

const mapProject = (row: ProjectRow, milestones: Milestone[]): Project => ({
  id: row.id,
  goalId: row.goal_id,
  goalTitle: row.goal_title,
  title: row.title,
  description: row.description,
  status: row.status,
  targetDate: row.target_date,
  taskCount: row.task_count,
  completedTaskCount: row.completed_task_count,
  progress: calculateProgress(row.completed_task_count, row.task_count),
  milestones,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const milestoneSelection = {
  id: milestones.id,
  project_id: milestones.projectId,
  user_id: milestones.userId,
  title: milestones.title,
  description: milestones.description,
  target_date: milestones.targetDate,
  position: milestones.position,
  status: milestones.status,
  task_count: sql<number>`count(distinct ${tasks.id})`,
  completed_task_count: sql<number>`count(distinct case when ${tasks.status} = 'done' then ${tasks.id} end)`,
}

const projectSelection = {
  id: projects.id,
  user_id: projects.userId,
  goal_id: projects.goalId,
  goal_title: goals.title,
  title: projects.title,
  description: projects.description,
  status: projects.status,
  target_date: projects.targetDate,
  created_at: projects.createdAt,
  updated_at: projects.updatedAt,
  task_count: sql<number>`count(distinct ${tasks.id})`,
  completed_task_count: sql<number>`count(distinct case when ${tasks.status} = 'done' then ${tasks.id} end)`,
}

const milestonesFor = (db: KobiDb, userId: string, projectId: string) => {
  const rows = db.select(milestoneSelection)
    .from(milestones)
    .leftJoin(tasks, eq(tasks.milestoneId, milestones.id))
    .where(and(eq(milestones.userId, userId), eq(milestones.projectId, projectId)))
    .groupBy(milestones.id)
    .orderBy(asc(milestones.position), asc(milestones.createdAt))
    .all() as MilestoneRow[]
  return rows.map(mapMilestone)
}

const assertGoal = (db: KobiDb, userId: string, goalId: string | null) => {
  if (!goalId) return
  const goal = db.select({ id: goals.id })
    .from(goals)
    .where(and(eq(goals.id, goalId), eq(goals.userId, userId)))
    .get()
  if (!goal) throw createError({ status: 422, statusText: 'Goal is not available' })
}

export const listProjects = (
  db: KobiDb,
  userId: string,
  options: { includeArchived?: boolean, goalId?: string } = {},
) => {
  const conditions = [eq(projects.userId, userId)]
  if (!options.includeArchived) conditions.push(ne(projects.status, 'archived'))
  if (options.goalId) conditions.push(eq(projects.goalId, options.goalId))
  const rows = db.select(projectSelection)
    .from(projects)
    .leftJoin(goals, eq(goals.id, projects.goalId))
    .leftJoin(tasks, eq(tasks.projectId, projects.id))
    .where(and(...conditions))
    .groupBy(projects.id)
    .orderBy(
      sql`case ${projects.status} when 'active' then 0 when 'paused' then 1 else 2 end`,
      sql`coalesce(${projects.targetDate}, '9999-12-31')`,
      desc(projects.createdAt),
    )
    .all() as ProjectRow[]
  return rows.map(row => mapProject(row, milestonesFor(db, userId, row.id)))
}

export const getProject = (db: KobiDb, userId: string, projectId: string) => {
  const row = db.select(projectSelection)
    .from(projects)
    .leftJoin(goals, eq(goals.id, projects.goalId))
    .leftJoin(tasks, eq(tasks.projectId, projects.id))
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .groupBy(projects.id)
    .get() as ProjectRow | undefined
  if (!row) throw createError({ status: 404, statusText: 'Project not found' })
  return mapProject(row, milestonesFor(db, userId, projectId))
}

export const createProject = (
  db: KobiDb,
  userId: string,
  input: CreateProjectInput,
) => {
  assertGoal(db, userId, input.goalId)
  const id = crypto.randomUUID()
  const now = nowIso()
  db.insert(projects).values({
    id,
    userId,
    goalId: input.goalId,
    title: input.title,
    description: input.description,
    status: 'active',
    targetDate: input.targetDate,
    createdAt: now,
    updatedAt: now,
  }).run()
  return getProject(db, userId, id)
}

export const updateProject = (
  db: KobiDb,
  userId: string,
  projectId: string,
  input: UpdateProjectInput,
) => {
  const current = getProject(db, userId, projectId)
  const goalId = input.goalId === undefined ? current.goalId : input.goalId
  assertGoal(db, userId, goalId)
  db.update(projects)
    .set({
      goalId,
      title: input.title ?? current.title,
      description: input.description ?? current.description,
      status: input.status ?? current.status,
      targetDate: input.targetDate === undefined ? current.targetDate : input.targetDate,
      updatedAt: nowIso(),
    })
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .run()
  return getProject(db, userId, projectId)
}

export const createMilestone = (
  db: KobiDb,
  userId: string,
  projectId: string,
  input: CreateMilestoneInput,
) => {
  getProject(db, userId, projectId)
  const id = crypto.randomUUID()
  const now = nowIso()
  const row = db.select({ position: sql<number>`coalesce(max(${milestones.position}), -1) + 1` })
    .from(milestones)
    .where(and(eq(milestones.projectId, projectId), eq(milestones.userId, userId)))
    .get()
  db.insert(milestones).values({
    id,
    userId,
    projectId,
    title: input.title,
    description: input.description,
    status: 'active',
    targetDate: input.targetDate,
    position: row?.position ?? 0,
    createdAt: now,
    updatedAt: now,
  }).run()
  return getProject(db, userId, projectId)
}

export const updateMilestone = (
  db: KobiDb,
  userId: string,
  milestoneId: string,
  input: UpdateMilestoneInput,
) => {
  const row = db.select({
    project_id: milestones.projectId,
    title: milestones.title,
    description: milestones.description,
    status: milestones.status,
    target_date: milestones.targetDate,
  }).from(milestones)
    .where(and(eq(milestones.id, milestoneId), eq(milestones.userId, userId)))
    .get()
  if (!row) throw createError({ status: 404, statusText: 'Milestone not found' })
  db.update(milestones)
    .set({
      title: input.title ?? row.title,
      description: input.description ?? row.description,
      status: input.status ?? row.status,
      targetDate: input.targetDate === undefined ? row.target_date : input.targetDate,
      updatedAt: nowIso(),
    })
    .where(and(eq(milestones.id, milestoneId), eq(milestones.userId, userId)))
    .run()
  return getProject(db, userId, row.project_id)
}
