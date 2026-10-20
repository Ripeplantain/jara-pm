import { workspaceParamsSchema } from '#shared/schemas/workspace'
import { activateWorkspace } from '~~/server/services/workspace'
import { requireWorkspaceMember } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'
import { captureServerEvent } from '~~/server/utils/posthog'

export default defineEventHandler(async (event) => {
  const { workspaceId } = await getValidatedRouterParams(event, workspaceParamsSchema.parse)
  const { user } = await requireWorkspaceMember(event, workspaceId)
  const workspace = activateWorkspace(useDatabase(event), user.id, workspaceId)
  captureServerEvent(event, user.id, 'workspace_activated')
  return workspace
})
