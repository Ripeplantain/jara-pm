import { createGoalSchema } from '#shared/schemas/goal'
import { createGoal } from '~~/server/services/goals'
import { requireMember } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'
import { captureServerEvent } from '~~/server/utils/posthog'

export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireMember(event)
  const body = await readValidatedBody(event, createGoalSchema.parse)
  const goal = createGoal(useDatabase(event), user.id, workspaceId, body)
  captureServerEvent(event, user.id, 'goal_created', { has_target_date: Boolean(body.targetDate) })
  setResponseStatus(event, 201)
  return goal
})
