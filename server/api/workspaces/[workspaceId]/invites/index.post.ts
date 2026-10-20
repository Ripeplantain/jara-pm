import { workspaceInviteSchema, workspaceParamsSchema } from '#shared/schemas/workspace'
import { createOrRefreshInvite } from '~~/server/services/workspace-invites'
import { requireWorkspaceOwner } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'
import { inviteBaseUrl } from '~~/server/utils/invite-url'
import { captureServerEvent } from '~~/server/utils/posthog'

export default defineEventHandler(async (event) => {
  const { workspaceId } = await getValidatedRouterParams(event, workspaceParamsSchema.parse)
  const { user } = await requireWorkspaceOwner(event, workspaceId)
  const body = await readValidatedBody(event, workspaceInviteSchema.parse)
  const config = useRuntimeConfig(event)
  const baseUrl = inviteBaseUrl(event)
  const result = await createOrRefreshInvite(useDatabase(event), {
    workspaceId,
    invitedBy: user.id,
    email: body.email,
    acceptUrl: token => `${baseUrl}/invite/${token}`,
    apiKey: config.resend.apiKey,
    from: config.resend.from,
  })
  captureServerEvent(event, user.id, 'invite_sent', { email_sent: result.emailSent })
  setResponseStatus(event, 201)
  return result
})
