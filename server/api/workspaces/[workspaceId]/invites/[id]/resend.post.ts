import { workspaceInviteParamsSchema } from '#shared/schemas/workspace'
import { resendInvite } from '~~/server/services/workspace-invites'
import { requireWorkspaceOwner } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'
import { inviteBaseUrl } from '~~/server/utils/invite-url'
import { captureServerEvent } from '~~/server/utils/posthog'

export default defineEventHandler(async (event) => {
  const { workspaceId, id } = await getValidatedRouterParams(event, workspaceInviteParamsSchema.parse)
  const { user } = await requireWorkspaceOwner(event, workspaceId)
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
