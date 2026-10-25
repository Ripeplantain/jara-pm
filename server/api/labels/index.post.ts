import { createLabelSchema } from '#shared/schemas/label'
import { createLabel } from '~~/server/services/labels'
import { requireMember } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'
import { captureServerEvent } from '~~/server/utils/posthog'

export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireMember(event)
  const body = await readValidatedBody(event, createLabelSchema.parse)
  const label = createLabel(useDatabase(event), user.id, workspaceId, body)
  captureServerEvent(event, user.id, 'label_created', {
    grouped: Boolean(body.groupId),
    color: body.color,
  })
  setResponseStatus(event, 201)
  return label
})
