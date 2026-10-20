import { idParamsSchema } from '#shared/schemas/query'
import { deleteTask } from '~~/server/services/tasks'
import { requireMember } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'
import { captureServerEvent } from '~~/server/utils/posthog'

export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireMember(event)
  const { id } = await getValidatedRouterParams(event, idParamsSchema.parse)
  deleteTask(useDatabase(event), user.id, workspaceId, id)
  captureServerEvent(event, user.id, 'task_deleted')
  return { ok: true }
})
