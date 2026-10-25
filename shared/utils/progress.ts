import { taskPoints } from '#shared/utils/estimates'

export const calculateProgress = (completed: number, total: number): number | null => {
  if (total <= 0) return null
  return Math.round(completed / total * 100)
}

export type WeighedTask = {
  estimate: number | null
  completed: boolean
  /** A canceled task is neither progress made nor work remaining, so it is skipped entirely. */
  canceled?: boolean
}

/**
 * Weighted progress. Every task contributes its estimate, or one point when it has none, so a
 * collection where nothing is estimated produces exactly the same number as counting tasks.
 *
 * An empty collection stays unmeasured (`null`), never 0 -- the same rule `calculateProgress`
 * follows, and the reason this delegates to it rather than dividing again.
 *
 * The rollups in `server/services` cannot call this -- they aggregate in SQL rather than loading
 * every task -- so `server/utils/task-points.ts` holds the SQL form of the same rule. This stays
 * as the executable reference the two are pinned against: `tests/estimates.test.ts` asserts the
 * SQL and this function agree on the same fixture.
 */
export const calculateWeightedProgress = (tasks: WeighedTask[]): number | null => {
  let total = 0
  let completed = 0
  for (const task of tasks) {
    if (task.canceled) continue
    const weight = taskPoints(task.estimate)
    total += weight
    if (task.completed) completed += weight
  }
  return calculateProgress(completed, total)
}
