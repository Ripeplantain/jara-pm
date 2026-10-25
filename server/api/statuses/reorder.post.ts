import { reorderStatusesSchema } from '#shared/schemas/status'
import { reorderStatuses } from '~~/server/services/statuses'
import { requireOwner } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'
import { captureServerEvent } from '~~/server/utils/posthog'

export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireOwner(event)
  const body = await readValidatedBody(event, reorderStatusesSchema.parse)
  const statuses = reorderStatuses(useDatabase(event), user.id, workspaceId, body)
  captureServerEvent(event, user.id, 'status_reordered')
  return statuses
})
