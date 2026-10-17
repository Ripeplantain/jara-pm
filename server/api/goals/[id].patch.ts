import { updateGoalSchema } from '#shared/schemas/goal'
import { idParamsSchema } from '#shared/schemas/query'
import { updateGoal } from '~~/server/services/goals'
import { requireUser } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'
import { captureServerEvent } from '~~/server/utils/posthog'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const { id } = await getValidatedRouterParams(event, idParamsSchema.parse)
  const body = await readValidatedBody(event, updateGoalSchema.parse)
  const goal = updateGoal(useDatabase(event), user.id, id, body)
  if (body.status) captureServerEvent(event, user.id, 'goal_status_changed', { status: body.status })
  return goal
})
