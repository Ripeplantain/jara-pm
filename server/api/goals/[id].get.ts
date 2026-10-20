import { idParamsSchema } from '#shared/schemas/query'
import { getGoal } from '~~/server/services/goals'
import { listProjects } from '~~/server/services/projects'
import { requireMember } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'

export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireMember(event)
  const { id } = await getValidatedRouterParams(event, idParamsSchema.parse)
  const db = useDatabase(event)
  return { goal: getGoal(db, user.id, workspaceId, id), projects: listProjects(db, user.id, workspaceId, { goalId: id }) }
})
