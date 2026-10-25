import { taskLabelSchema } from '#shared/schemas/label'
import { idParamsSchema } from '#shared/schemas/query'
import { attachTaskLabel } from '~~/server/services/labels'
import { getTask } from '~~/server/services/tasks'
import { requireMember } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'
import { captureServerEvent } from '~~/server/utils/posthog'

export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireMember(event)
  const { id } = await getValidatedRouterParams(event, idParamsSchema.parse)
  const body = await readValidatedBody(event, taskLabelSchema.parse)
  const db = useDatabase(event)
  attachTaskLabel(db, user.id, workspaceId, id, body.labelId)
  captureServerEvent(event, user.id, 'task_label_attached')
  return getTask(db, user.id, workspaceId, id)
})
