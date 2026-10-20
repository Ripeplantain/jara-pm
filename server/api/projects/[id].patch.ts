import { idParamsSchema } from '#shared/schemas/query'
import { updateProjectSchema } from '#shared/schemas/project'
import { updateProject } from '~~/server/services/projects'
import { requireMember } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'
import { captureServerEvent } from '~~/server/utils/posthog'

export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireMember(event)
  const { id } = await getValidatedRouterParams(event, idParamsSchema.parse)
  const body = await readValidatedBody(event, updateProjectSchema.parse)
  const project = updateProject(useDatabase(event), user.id, workspaceId, id, body)
  if (body.status === 'archived') captureServerEvent(event, user.id, 'project_archived')
  return project
})
