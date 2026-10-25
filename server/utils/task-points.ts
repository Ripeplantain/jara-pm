import { eq, sql } from 'drizzle-orm'
import type { KobiDb } from '~~/server/db'
import { statuses, tasks, workspaces } from '~~/server/db/schema'

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
 * rollups so the weighting rule and the completed/canceled rule each have one definition. An
 * unestimated task is worth one point, so a collection with no estimates weighs exactly as much
 * as it counts.
 *
 * Callers must LEFT JOIN `statuses` on `tasks.status_id` alongside the tasks join.
 *
 * Completion is "the status category is `completed`". A `canceled` task leaves BOTH sides of the
 * ratio -- it is neither progress made nor work remaining -- so a project holding one done task
 * and one canceled task is 100%, not 50%, and a project holding only canceled tasks is
 * unmeasured (`null`) rather than 0% or 100%.
 *
 * The `id is not null` guard is what keeps invariant 5 true. The rollups LEFT JOIN tasks, so an
 * empty collection still yields one row of nulls, and a bare `coalesce(estimate, 1)` would weigh
 * that phantom row as a single point -- reporting an empty project as 0% complete instead of
 * unmeasured. Guarded, an empty collection sums to 0 and `calculateProgress` returns null.
 */
export const taskRollupColumns = (weighted: boolean) => {
  const weight = weighted ? sql`coalesce(${tasks.estimate}, 1)` : sql`1`
  const counted = sql`${tasks.id} is not null and ${statuses.category} != 'canceled'`
  const done = sql`${tasks.id} is not null and ${statuses.category} = 'completed'`
  return {
    task_count: sql<number>`count(distinct case when ${counted} then ${tasks.id} end)`,
    completed_task_count: sql<number>`count(distinct case when ${done} then ${tasks.id} end)`,
    points: sql<number>`coalesce(sum(case when ${counted} then ${weight} else 0 end), 0)`,
    completed_points: sql<number>`coalesce(sum(case when ${done} then ${weight} else 0 end), 0)`,
  }
}
