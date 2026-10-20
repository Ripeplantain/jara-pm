import { workspaceMemberParamsSchema } from '#shared/schemas/workspace'
import { removeWorkspaceMember } from '~~/server/services/workspace-invites'
import { requireWorkspaceOwner } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'
import { captureServerEvent } from '~~/server/utils/posthog'

export default defineEventHandler(async (event) => {
  const { workspaceId, userId } = await getValidatedRouterParams(event, workspaceMemberParamsSchema.parse)
  const { user } = await requireWorkspaceOwner(event, workspaceId)
  removeWorkspaceMember(useDatabase(event), workspaceId, userId, user.id)
  captureServerEvent(event, user.id, 'member_removed')
  setResponseStatus(event, 204)
  return null
})
