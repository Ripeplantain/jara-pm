import { revokeInvite } from '~~/server/services/workspace-invites'
import { requireOwner } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'
import { captureServerEvent } from '~~/server/utils/posthog'

export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireOwner(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ status: 400, statusText: 'Invite ID is required' })
  revokeInvite(useDatabase(event), workspaceId, id)
  captureServerEvent(event, user.id, 'invite_revoked')
  setResponseStatus(event, 204)
  return null
})
