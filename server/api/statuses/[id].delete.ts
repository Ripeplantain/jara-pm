import { idParamsSchema } from '#shared/schemas/query'
import { deleteStatusQuerySchema } from '#shared/schemas/status'
import { deleteStatus, getStatus } from '~~/server/services/statuses'
import { requireOwner } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'
import { captureServerEvent } from '~~/server/utils/posthog'

export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireOwner(event)
  const { id } = await getValidatedRouterParams(event, idParamsSchema.parse)
  const query = await getValidatedQuery(event, deleteStatusQuerySchema.parse)
  const db = useDatabase(event)
  const { category } = getStatus(db, workspaceId, id)
  deleteStatus(db, user.id, workspaceId, id, query.replacementStatusId)
  captureServerEvent(event, user.id, 'status_deleted', { category })
  setResponseStatus(event, 204)
  return null
})
