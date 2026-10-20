import { acceptInvite } from '~~/server/services/workspace-invites'
import { requireUser } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'
import { captureServerEvent } from '~~/server/utils/posthog'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const token = getRouterParam(event, 'token')
  if (!token) throw createError({ status: 400, statusText: 'Invite token is required' })
  const result = acceptInvite(useDatabase(event), user, token)
  captureServerEvent(event, user.id, 'invite_accepted')
  return result
})
