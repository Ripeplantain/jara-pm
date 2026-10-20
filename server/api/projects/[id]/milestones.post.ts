import { idParamsSchema } from '#shared/schemas/query'
import { createMilestoneSchema } from '#shared/schemas/project'
import { createMilestone } from '~~/server/services/projects'
import { requireMember } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'
import { captureServerEvent } from '~~/server/utils/posthog'

export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireMember(event)
  const { id } = await getValidatedRouterParams(event, idParamsSchema.parse)
  const body = await readValidatedBody(event, createMilestoneSchema.parse)
  const project = createMilestone(useDatabase(event), user.id, workspaceId, id, body)
  captureServerEvent(event, user.id, 'milestone_created', { has_target_date: Boolean(body.targetDate) })
  setResponseStatus(event, 201)
  return project
})
