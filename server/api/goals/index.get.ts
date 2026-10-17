import { collectionQuerySchema } from '#shared/schemas/query'
import { listGoals } from '~~/server/services/goals'
import { requireUser } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const query = await getValidatedQuery(event, collectionQuerySchema.pick({ includeArchived: true }).parse)
  return listGoals(useDatabase(event), user.id, query.includeArchived)
})
