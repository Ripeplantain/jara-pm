import { updateLabelSchema } from '#shared/schemas/label'
import { idParamsSchema } from '#shared/schemas/query'
import { updateLabel } from '~~/server/services/labels'
import { requireMember } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'
import { captureServerEvent } from '~~/server/utils/posthog'

export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireMember(event)
  const { id } = await getValidatedRouterParams(event, idParamsSchema.parse)
  const body = await readValidatedBody(event, updateLabelSchema.parse)
  const label = updateLabel(useDatabase(event), user.id, workspaceId, id, body)
  if (body.archived !== undefined) {
    captureServerEvent(event, user.id, 'label_archive_toggled', { archived: body.archived })
  }
  return label
})
