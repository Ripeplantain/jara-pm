import { createGoalSchema } from '#shared/schemas/goal'
import { createGoal } from '~~/server/services/goals'
import { requireUser } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'
import { captureServerEvent } from '~~/server/utils/posthog'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const body = await readValidatedBody(event, createGoalSchema.parse)
  const goal = createGoal(useDatabase(event), user.id, body)
  captureServerEvent(event, user.id, 'goal_created', { has_target_date: Boolean(body.targetDate) })
  setResponseStatus(event, 201)
  return goal
})
