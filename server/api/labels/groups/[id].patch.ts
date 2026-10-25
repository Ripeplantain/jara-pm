import { updateLabelGroupSchema } from '#shared/schemas/label'
import { idParamsSchema } from '#shared/schemas/query'
import { updateLabelGroup } from '~~/server/services/labels'
import { requireMember } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'

export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireMember(event)
  const { id } = await getValidatedRouterParams(event, idParamsSchema.parse)
  const body = await readValidatedBody(event, updateLabelGroupSchema.parse)
  return updateLabelGroup(useDatabase(event), user.id, workspaceId, id, body)
})
