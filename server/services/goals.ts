import type Database from 'better-sqlite3'
import type { CreateGoalInput, UpdateGoalInput } from '#shared/schemas/goal'
import type { Goal } from '#shared/types/domain'
import { calculateProgress } from '#shared/utils/progress'
import type { GoalRow } from '~~/server/types/database'
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
  progress: calculateProgress(row.completed_task_count, row.task_count),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const GOAL_SELECT = `
  SELECT goals.*,
         COUNT(DISTINCT projects.id) AS project_count,
         COUNT(DISTINCT tasks.id) AS task_count,
         COUNT(DISTINCT CASE WHEN tasks.status = 'done' THEN tasks.id END) AS completed_task_count
  FROM goals
  LEFT JOIN projects ON projects.goal_id = goals.id AND projects.status != 'archived'
  LEFT JOIN tasks ON tasks.project_id = projects.id
`

export const listGoals = (db: Database.Database, userId: string, includeArchived = false) => {
  const rows = db.prepare(`
    ${GOAL_SELECT}
    WHERE goals.user_id = ? ${includeArchived ? '' : "AND goals.status != 'archived'"}
    GROUP BY goals.id
    ORDER BY CASE goals.status WHEN 'active' THEN 0 WHEN 'completed' THEN 1 ELSE 2 END,
             COALESCE(goals.target_date, '9999-12-31'), goals.created_at DESC
  `).all(userId) as GoalRow[]
  return rows.map(mapGoal)
}

export const getGoal = (db: Database.Database, userId: string, goalId: string) => {
  const row = db.prepare(`
    ${GOAL_SELECT}
    WHERE goals.id = ? AND goals.user_id = ?
    GROUP BY goals.id
  `).get(goalId, userId) as GoalRow | undefined
  if (!row) throw createError({ status: 404, statusText: 'Goal not found' })
  return mapGoal(row)
}

export const createGoal = (db: Database.Database, userId: string, input: CreateGoalInput) => {
  const id = crypto.randomUUID()
  const now = nowIso()
  db.prepare(`
    INSERT INTO goals (id, user_id, title, description, status, target_date, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
  `).run(id, userId, input.title, input.description, input.targetDate, now, now)
  return getGoal(db, userId, id)
}

export const updateGoal = (
  db: Database.Database,
  userId: string,
  goalId: string,
  input: UpdateGoalInput,
) => {
  const current = getGoal(db, userId, goalId)
  db.prepare(`
    UPDATE goals SET title = ?, description = ?, status = ?, target_date = ?, updated_at = ?
    WHERE id = ? AND user_id = ?
  `).run(
    input.title ?? current.title,
    input.description ?? current.description,
    input.status ?? current.status,
    input.targetDate === undefined ? current.targetDate : input.targetDate,
    nowIso(), goalId, userId,
  )
  return getGoal(db, userId, goalId)
}
