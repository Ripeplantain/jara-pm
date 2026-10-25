import type { TodayData } from '#shared/types/domain'
import type { KobiDb } from '~~/server/db'
import { todayIso } from '~~/server/utils/time'
import { listTasks } from '~~/server/services/tasks'

export const getToday = (db: KobiDb, userId: string, workspaceId: string): TodayData => {
  const today = todayIso()
  const priorities = listTasks(db, userId, workspaceId, { scope: 'today' })
  // One pass over every task serves both the overdue list and what was finished today, which
  // `completedAt` records exactly rather than by inference.
  const allTasks = listTasks(db, userId, workspaceId, { scope: 'all' })
  const allOpen = allTasks.filter(task => task.status.category !== 'completed' && task.status.category !== 'canceled')
  const completedToday = allTasks.filter(task => task.status.category === 'completed' && task.completedAt?.slice(0, 10) === today)
  const overdue = allOpen
    .filter(task => task.dueDate !== null && task.dueDate < today)
    .sort((left, right) => {
      const dueDateOrder = (left.dueDate ?? '').localeCompare(right.dueDate ?? '')
      if (dueDateOrder !== 0) return dueDateOrder
      const priorityOrder = { high: 0, medium: 1, low: 2, none: 2 }
      return priorityOrder[left.priority] - priorityOrder[right.priority]
    })
  const upcoming = listTasks(db, userId, workspaceId, { scope: 'upcoming' }).slice(0, 5)
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning.' : hour < 18 ? 'Good afternoon.' : 'Good evening.'

  const suggestion = priorities.length === 0 && overdue.length > 0
    ? `Start by rescheduling or completing “${overdue[0]?.title}”.`
    : priorities.length > 5
      ? 'You have a full day. Pick three tasks that would make today feel complete.'
      : null

  return { date: today, greeting, priorities, overdue, upcoming, completedToday, suggestion }
}
