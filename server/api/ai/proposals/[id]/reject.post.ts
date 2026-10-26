import { idParamsSchema } from '#shared/schemas/query'
import { rejectProposal } from '~~/server/services/ai'
import { requireMember } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'
import { captureServerEvent } from '~~/server/utils/posthog'

export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireMember(event)
  const { id } = await getValidatedRouterParams(event, idParamsSchema.parse)
  const result = rejectProposal(useDatabase(event), user.id, workspaceId, id)
  captureServerEvent(event, user.id, 'ask_kobi_proposal_rejected')
  return result
})
