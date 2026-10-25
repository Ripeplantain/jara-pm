import { labelQuerySchema } from '#shared/schemas/label'
import { listLabels } from '~~/server/services/labels'
import { requireMember } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'

export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireMember(event)
  const query = await getValidatedQuery(event, labelQuerySchema.parse)
  return listLabels(useDatabase(event), workspaceId, { includeArchived: query.includeArchived })
})
