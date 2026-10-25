import { idParamsSchema } from '#shared/schemas/query'
import { updateStatusSchema } from '#shared/schemas/status'
import { updateStatus } from '~~/server/services/statuses'
import { requireOwner } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'
import { captureServerEvent } from '~~/server/utils/posthog'

export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireOwner(event)
  const { id } = await getValidatedRouterParams(event, idParamsSchema.parse)
  const body = await readValidatedBody(event, updateStatusSchema.parse)
  const status = updateStatus(useDatabase(event), user.id, workspaceId, id, body)
  if (body.name !== undefined) captureServerEvent(event, user.id, 'status_renamed', { category: status.category })
  return status
})
