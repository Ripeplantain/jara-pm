import { idParamsSchema } from '#shared/schemas/query'
import { deleteLabel } from '~~/server/services/labels'
import { requireOwner } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'
import { captureServerEvent } from '~~/server/utils/posthog'

export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireOwner(event)
  const { id } = await getValidatedRouterParams(event, idParamsSchema.parse)
  deleteLabel(useDatabase(event), user.id, workspaceId, id)
  captureServerEvent(event, user.id, 'label_deleted')
  setResponseStatus(event, 204)
  return null
})
