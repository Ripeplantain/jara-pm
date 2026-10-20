import { collectionQuerySchema } from '#shared/schemas/query'
import { listGoals } from '~~/server/services/goals'
import { requireMember } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'

export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireMember(event)
  const query = await getValidatedQuery(event, collectionQuerySchema.pick({ includeArchived: true }).parse)
  return listGoals(useDatabase(event), user.id, workspaceId, query.includeArchived)
})
