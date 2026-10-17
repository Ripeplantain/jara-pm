export const calculateProgress = (completed: number, total: number): number | null => {
  if (total <= 0) return null
  return Math.round(completed / total * 100)
}
