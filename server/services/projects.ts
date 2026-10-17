import type Database from 'better-sqlite3'
import type {
  CreateMilestoneInput,
  CreateProjectInput,
  UpdateMilestoneInput,
  UpdateProjectInput,
} from '#shared/schemas/project'
import type { Milestone, Project } from '#shared/types/domain'
import { calculateProgress } from '#shared/utils/progress'
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

const PROJECT_SELECT = `
  SELECT projects.*,
         goals.title AS goal_title,
         COUNT(DISTINCT tasks.id) AS task_count,
         COUNT(DISTINCT CASE WHEN tasks.status = 'done' THEN tasks.id END) AS completed_task_count
  FROM projects
  LEFT JOIN goals ON goals.id = projects.goal_id
  LEFT JOIN tasks ON tasks.project_id = projects.id
`

const milestonesFor = (db: Database.Database, userId: string, projectId: string) => {
  const rows = db.prepare(`
    SELECT milestones.*,
           COUNT(DISTINCT tasks.id) AS task_count,
           COUNT(DISTINCT CASE WHEN tasks.status = 'done' THEN tasks.id END) AS completed_task_count
    FROM milestones
    LEFT JOIN tasks ON tasks.milestone_id = milestones.id
    WHERE milestones.user_id = ? AND milestones.project_id = ?
    GROUP BY milestones.id
    ORDER BY milestones.position, milestones.created_at
  `).all(userId, projectId) as MilestoneRow[]
  return rows.map(mapMilestone)
}

const assertGoal = (db: Database.Database, userId: string, goalId: string | null) => {
  if (!goalId) return
  const goal = db.prepare('SELECT id FROM goals WHERE id = ? AND user_id = ?')
    .get(goalId, userId)
  if (!goal) throw createError({ status: 422, statusText: 'Goal is not available' })
}

export const listProjects = (
  db: Database.Database,
  userId: string,
  options: { includeArchived?: boolean, goalId?: string } = {},
) => {
  const clauses = ['projects.user_id = ?']
  const params = [userId]
  if (!options.includeArchived) clauses.push("projects.status != 'archived'")
  if (options.goalId) {
    clauses.push('projects.goal_id = ?')
    params.push(options.goalId)
  }
  const rows = db.prepare(`
    ${PROJECT_SELECT}
    WHERE ${clauses.join(' AND ')}
    GROUP BY projects.id
    ORDER BY CASE projects.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,
             COALESCE(projects.target_date, '9999-12-31'), projects.created_at DESC
  `).all(...params) as ProjectRow[]
  return rows.map(row => mapProject(row, milestonesFor(db, userId, row.id)))
}

export const getProject = (db: Database.Database, userId: string, projectId: string) => {
  const row = db.prepare(`
    ${PROJECT_SELECT}
    WHERE projects.id = ? AND projects.user_id = ?
    GROUP BY projects.id
  `).get(projectId, userId) as ProjectRow | undefined
  if (!row) throw createError({ status: 404, statusText: 'Project not found' })
  return mapProject(row, milestonesFor(db, userId, projectId))
}

export const createProject = (
  db: Database.Database,
  userId: string,
  input: CreateProjectInput,
) => {
  assertGoal(db, userId, input.goalId)
  const id = crypto.randomUUID()
  const now = nowIso()
  db.prepare(`
    INSERT INTO projects (
      id, user_id, goal_id, title, description, status, target_date, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
  `).run(id, userId, input.goalId, input.title, input.description, input.targetDate, now, now)
  return getProject(db, userId, id)
}

export const updateProject = (
  db: Database.Database,
  userId: string,
  projectId: string,
  input: UpdateProjectInput,
) => {
  const current = getProject(db, userId, projectId)
  const goalId = input.goalId === undefined ? current.goalId : input.goalId
  assertGoal(db, userId, goalId)
  db.prepare(`
    UPDATE projects SET goal_id = ?, title = ?, description = ?, status = ?, target_date = ?, updated_at = ?
    WHERE id = ? AND user_id = ?
  `).run(
    goalId,
    input.title ?? current.title,
    input.description ?? current.description,
    input.status ?? current.status,
    input.targetDate === undefined ? current.targetDate : input.targetDate,
    nowIso(), projectId, userId,
  )
  return getProject(db, userId, projectId)
}

export const createMilestone = (
  db: Database.Database,
  userId: string,
  projectId: string,
  input: CreateMilestoneInput,
) => {
  getProject(db, userId, projectId)
  const id = crypto.randomUUID()
  const now = nowIso()
  const row = db.prepare(`
    SELECT COALESCE(MAX(position), -1) + 1 AS position
    FROM milestones WHERE project_id = ? AND user_id = ?
  `).get(projectId, userId) as { position: number }
  db.prepare(`
    INSERT INTO milestones (
      id, user_id, project_id, title, description, status, target_date, position, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
  `).run(id, userId, projectId, input.title, input.description, input.targetDate, row.position, now, now)
  return getProject(db, userId, projectId)
}

export const updateMilestone = (
  db: Database.Database,
  userId: string,
  milestoneId: string,
  input: UpdateMilestoneInput,
) => {
  const row = db.prepare('SELECT * FROM milestones WHERE id = ? AND user_id = ?')
    .get(milestoneId, userId) as {
      project_id: string
      title: string
      description: string
      status: 'active' | 'completed'
      target_date: string | null
    } | undefined
  if (!row) throw createError({ status: 404, statusText: 'Milestone not found' })
  db.prepare(`
    UPDATE milestones SET title = ?, description = ?, status = ?, target_date = ?, updated_at = ?
    WHERE id = ? AND user_id = ?
  `).run(
    input.title ?? row.title,
    input.description ?? row.description,
    input.status ?? row.status,
    input.targetDate === undefined ? row.target_date : input.targetDate,
    nowIso(), milestoneId, userId,
  )
  return getProject(db, userId, row.project_id)
}
