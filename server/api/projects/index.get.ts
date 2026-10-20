import { collectionQuerySchema } from '#shared/schemas/query'
import { listProjects } from '~~/server/services/projects'
import { requireMember } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'

export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireMember(event)
  const query = await getValidatedQuery(event, collectionQuerySchema.parse)
  return listProjects(useDatabase(event), user.id, workspaceId, query)
})
