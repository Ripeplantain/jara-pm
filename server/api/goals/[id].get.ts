import { idParamsSchema } from '#shared/schemas/query'
import { getGoal } from '~~/server/services/goals'
import { listProjects } from '~~/server/services/projects'
import { requireUser } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const { id } = await getValidatedRouterParams(event, idParamsSchema.parse)
  const db = useDatabase(event)
  return { goal: getGoal(db, user.id, id), projects: listProjects(db, user.id, { goalId: id }) }
})
