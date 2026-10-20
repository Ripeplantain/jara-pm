import { createWorkspaceSchema } from '#shared/schemas/workspace'
import { createWorkspace } from '~~/server/services/workspace'
import { requireUser } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'
import { captureServerEvent } from '~~/server/utils/posthog'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const body = await readValidatedBody(event, createWorkspaceSchema.parse)
  const workspace = createWorkspace(useDatabase(event), user.id, body)
  captureServerEvent(event, user.id, 'workspace_created')
  setResponseStatus(event, 201)
  return workspace
})
