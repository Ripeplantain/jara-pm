import { createStatusSchema } from '#shared/schemas/status'
import { createStatus } from '~~/server/services/statuses'
import { requireOwner } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'
import { captureServerEvent } from '~~/server/utils/posthog'

// Workflow configuration is owner-only; any member may read it (see index.get.ts).
export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireOwner(event)
  const body = await readValidatedBody(event, createStatusSchema.parse)
  const status = createStatus(useDatabase(event), user.id, workspaceId, body)
  captureServerEvent(event, user.id, 'status_created', { category: status.category })
  setResponseStatus(event, 201)
  return status
})
