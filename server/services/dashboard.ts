import type { TodayData } from '#shared/types/domain'
import type { KobiDb } from '~~/server/db'
import { todayIso } from '~~/server/utils/time'
import { listTasks } from '~~/server/services/tasks'

export const getToday = (db: KobiDb, userId: string): TodayData => {
  const today = todayIso()
  const priorities = listTasks(db, userId, { scope: 'today' })
  const allOpen = listTasks(db, userId, { scope: 'all' }).filter(task => task.status !== 'done')
  const overdue = allOpen
    .filter(task => task.dueDate !== null && task.dueDate < today)
    .sort((left, right) => {
      const dueDateOrder = (left.dueDate ?? '').localeCompare(right.dueDate ?? '')
      if (dueDateOrder !== 0) return dueDateOrder
      const priorityOrder = { high: 0, medium: 1, low: 2, none: 2 }
      return priorityOrder[left.priority] - priorityOrder[right.priority]
    })
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
