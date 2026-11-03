import { idParamsSchema } from '#shared/schemas/query'
import { deleteProject } from '~~/server/services/projects'
import { requireMember } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'
import { captureServerEvent } from '~~/server/utils/posthog'

export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireMember(event)
  const { id } = await getValidatedRouterParams(event, idParamsSchema.parse)
  const result = deleteProject(useDatabase(event), user.id, workspaceId, id)
  captureServerEvent(event, user.id, 'project_deleted')
  return result
})
