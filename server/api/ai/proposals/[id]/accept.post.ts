import { idParamsSchema } from '#shared/schemas/query'
import { acceptProposal } from '~~/server/services/ai'
import { requireUser } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'
import { captureServerEvent } from '~~/server/utils/posthog'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const { id } = await getValidatedRouterParams(event, idParamsSchema.parse)
  const result = acceptProposal(useDatabase(event), user.id, id)
  captureServerEvent(event, user.id, 'ask_kobi_plan_accepted')
  return result
})
