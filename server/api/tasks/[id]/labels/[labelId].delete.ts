import { taskLabelParamsSchema } from '#shared/schemas/label'
import { detachTaskLabel } from '~~/server/services/labels'
import { getTask } from '~~/server/services/tasks'
import { requireMember } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'
import { captureServerEvent } from '~~/server/utils/posthog'

export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireMember(event)
  const { id, labelId } = await getValidatedRouterParams(event, taskLabelParamsSchema.parse)
  const db = useDatabase(event)
  detachTaskLabel(db, user.id, workspaceId, id, labelId)
  captureServerEvent(event, user.id, 'task_label_detached')
  return getTask(db, user.id, workspaceId, id)
})
