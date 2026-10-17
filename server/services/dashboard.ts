import type Database from 'better-sqlite3'
import type { TodayData } from '#shared/types/domain'
import type { TaskRow } from '~~/server/types/database'
import { todayIso } from '~~/server/utils/time'
import { listTasks } from '~~/server/services/tasks'

export const getToday = (db: Database.Database, userId: string): TodayData => {
  const today = todayIso()
  const priorities = listTasks(db, userId, { scope: 'today' })
  const overdueRows = db.prepare(`
    SELECT tasks.*, projects.title AS project_title, milestones.title AS milestone_title
    FROM tasks
    LEFT JOIN projects ON projects.id = tasks.project_id
    LEFT JOIN milestones ON milestones.id = tasks.milestone_id
    WHERE tasks.user_id = ? AND tasks.status != 'done' AND tasks.due_date < ?
    ORDER BY tasks.due_date, CASE tasks.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END
  `).all(userId, today) as TaskRow[]
  const overdueIds = new Set(overdueRows.map(row => row.id))
  const allOpen = listTasks(db, userId, { scope: 'all' }).filter(task => task.status !== 'done')
  const overdue = allOpen.filter(task => overdueIds.has(task.id))
  const upcoming = listTasks(db, userId, { scope: 'upcoming' }).slice(0, 5)
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning.' : hour < 18 ? 'Good afternoon.' : 'Good evening.'

  const suggestion = priorities.length === 0 && overdue.length > 0
    ? `Start by rescheduling or completing “${overdue[0]?.title}”.`
    : priorities.length > 5
      ? 'You have a full day. Pick three tasks that would make today feel complete.'
      : null

  return { date: today, greeting, priorities, overdue, upcoming, suggestion }
}
