import { eq, sql } from 'drizzle-orm'
import type { KobiDb } from '~~/server/db'
import { tasks, workspaces } from '~~/server/db/schema'

/**
 * Whether a workspace weighs progress by estimate points at all.
 *
 * A workspace on the `none` scale shows no estimate field, so weighing by estimates stored
 * before the scale was turned off would print a percentage that does not match the task counts
 * shown beside it, with no way for the user to see or clear the cause. Stored estimates are
 * deliberately kept (changing the scale must never rewrite them) and simply ignored until a
 * scale is chosen again.
 */
export const workspaceWeighsEstimates = (db: KobiDb, workspaceId: string): boolean => {
  const row = db.select({ scale: workspaces.estimateScale })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .get()
  return (row?.scale ?? 'none') !== 'none'
}

/**
 * The SQL form of `calculateWeightedProgress`, shared by the goal, project and milestone
 * rollups so the weighting rule has one definition. An unestimated task is worth one point, so
 * a collection with no estimates weighs exactly as much as it counts.
 *
 * The `id is not null` guard is what keeps invariant 5 true. The rollups LEFT JOIN tasks, so an
 * empty collection still yields one row of nulls, and a bare `coalesce(estimate, 1)` would weigh
 * that phantom row as a single point -- reporting an empty project as 0% complete instead of
 * unmeasured. Guarded, an empty collection sums to 0 and `calculateProgress` returns null.
 */
export const taskPointColumns = (weighted: boolean) => {
  const weight = weighted ? sql`coalesce(${tasks.estimate}, 1)` : sql`1`
  return {
    points: sql<number>`coalesce(sum(case when ${tasks.id} is not null then ${weight} else 0 end), 0)`,
    completed_points: sql<number>`coalesce(sum(case when ${tasks.id} is not null and ${tasks.status} = 'done' then ${weight} else 0 end), 0)`,
  }
}
