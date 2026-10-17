import { idParamsSchema } from '#shared/schemas/query'
import { updateProjectSchema } from '#shared/schemas/project'
import { updateProject } from '~~/server/services/projects'
import { requireUser } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const { id } = await getValidatedRouterParams(event, idParamsSchema.parse)
  const body = await readValidatedBody(event, updateProjectSchema.parse)
  return updateProject(useDatabase(event), user.id, id, body)
})
