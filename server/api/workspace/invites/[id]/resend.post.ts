import { resendInvite } from '~~/server/services/workspace-invites'
import { requireOwner } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'
import { captureServerEvent } from '~~/server/utils/posthog'
import { inviteBaseUrl } from '~~/server/utils/invite-url'

export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireOwner(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ status: 400, statusText: 'Invite ID is required' })
  const config = useRuntimeConfig(event)
  const baseUrl = inviteBaseUrl(event)
  const result = await resendInvite(useDatabase(event), {
    workspaceId,
    inviteId: id,
    invitedBy: user.id,
    acceptUrl: token => `${baseUrl}/invite/${token}`,
    apiKey: config.resend.apiKey,
    from: config.resend.from,
  })
  captureServerEvent(event, user.id, 'invite_resent', { email_sent: result.emailSent })
  return result
})
