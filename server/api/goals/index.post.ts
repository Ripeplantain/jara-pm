import { createGoalSchema } from '#shared/schemas/goal'
import { createGoal } from '~~/server/services/goals'
import { requireUser } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const body = await readValidatedBody(event, createGoalSchema.parse)
  const goal = createGoal(useDatabase(event), user.id, body)
  setResponseStatus(event, 201)
  return goal
})
