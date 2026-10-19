import type { TaskRecurrence } from '#shared/types/domain'

const dateValue = (value: string) => {
  const [year = 0, month = 1, day = 1] = value.split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

const dateString = (value: number) => new Date(value).toISOString().slice(0, 10)

export const nextRecurringDate = (
  date: string,
  recurrence: TaskRecurrence,
  afterDate?: string,
) => {
  if (recurrence === 'none') return null

  const increment = recurrence === 'daily' ? 1 : 7
  let next = dateValue(date) + increment * 86_400_000
  if (afterDate) {
    const boundary = dateValue(afterDate)
    while (next <= boundary) next += increment * 86_400_000
  }
  return dateString(next)
}
