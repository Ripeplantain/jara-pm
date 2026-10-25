import { createLabelGroupSchema } from '#shared/schemas/label'
import { createLabelGroup } from '~~/server/services/labels'
import { requireMember } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'
import { captureServerEvent } from '~~/server/utils/posthog'

export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireMember(event)
  const body = await readValidatedBody(event, createLabelGroupSchema.parse)
  const group = createLabelGroup(useDatabase(event), user.id, workspaceId, body)
  captureServerEvent(event, user.id, 'label_group_created')
  setResponseStatus(event, 201)
  return group
})
