export const useDateFormat = () => {
  const formatDate = (value: string | null, options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) => {
    if (!value) return ''
    return new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', ...options }).format(new Date(`${value}T00:00:00Z`))
  }

  const formatLongDate = (value: string) => formatDate(value, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })

  return { formatDate, formatLongDate }
}
