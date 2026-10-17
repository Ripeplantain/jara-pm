import { idParamsSchema } from '#shared/schemas/query'
import { deleteTask } from '~~/server/services/tasks'
import { requireUser } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'
import { captureServerEvent } from '~~/server/utils/posthog'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const { id } = await getValidatedRouterParams(event, idParamsSchema.parse)
  deleteTask(useDatabase(event), user.id, id)
  captureServerEvent(event, user.id, 'task_deleted')
  return { ok: true }
})
