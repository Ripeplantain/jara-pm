import { idParamsSchema } from '#shared/schemas/query'
import { deleteLabelGroup } from '~~/server/services/labels'
import { requireOwner } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'

export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireOwner(event)
  const { id } = await getValidatedRouterParams(event, idParamsSchema.parse)
  deleteLabelGroup(useDatabase(event), user.id, workspaceId, id)
  setResponseStatus(event, 204)
  return null
})
