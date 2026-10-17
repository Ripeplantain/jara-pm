import { idParamsSchema } from '#shared/schemas/query'
import { updateMilestoneSchema } from '#shared/schemas/project'
import { updateMilestone } from '~~/server/services/projects'
import { requireUser } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const { id } = await getValidatedRouterParams(event, idParamsSchema.parse)
  const body = await readValidatedBody(event, updateMilestoneSchema.parse)
  return updateMilestone(useDatabase(event), user.id, id, body)
})
