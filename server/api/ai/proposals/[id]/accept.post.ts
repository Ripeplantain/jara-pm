import { idParamsSchema } from '#shared/schemas/query'
import { acceptProposal } from '~~/server/services/ai'
import { requireUser } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const { id } = await getValidatedRouterParams(event, idParamsSchema.parse)
  return acceptProposal(useDatabase(event), user.id, id)
})
