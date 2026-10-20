import { removeWorkspaceMember } from '~~/server/services/workspace-invites'
import { requireOwner } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'
import { captureServerEvent } from '~~/server/utils/posthog'

export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireOwner(event)
  const userId = getRouterParam(event, 'userId')
  if (!userId) throw createError({ status: 400, statusText: 'User ID is required' })
  removeWorkspaceMember(useDatabase(event), workspaceId, userId, user.id)
  captureServerEvent(event, user.id, 'member_removed')
  setResponseStatus(event, 204)
  return null
})
