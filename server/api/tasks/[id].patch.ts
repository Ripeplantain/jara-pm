import { idParamsSchema } from '#shared/schemas/query'
import { updateTaskSchema } from '#shared/schemas/task'
import { updateTask } from '~~/server/services/tasks'
import { requireUser } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const { id } = await getValidatedRouterParams(event, idParamsSchema.parse)
  const body = await readValidatedBody(event, updateTaskSchema.parse)
  return updateTask(useDatabase(event), user.id, id, body)
})
