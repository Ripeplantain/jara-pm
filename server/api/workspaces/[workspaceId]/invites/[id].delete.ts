import { workspaceInviteParamsSchema } from '#shared/schemas/workspace'
import { revokeInvite } from '~~/server/services/workspace-invites'
import { requireWorkspaceOwner } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'
import { captureServerEvent } from '~~/server/utils/posthog'

export default defineEventHandler(async (event) => {
  const { workspaceId, id } = await getValidatedRouterParams(event, workspaceInviteParamsSchema.parse)
  const { user } = await requireWorkspaceOwner(event, workspaceId)
  revokeInvite(useDatabase(event), workspaceId, id)
  captureServerEvent(event, user.id, 'invite_revoked')
  setResponseStatus(event, 204)
  return null
})
