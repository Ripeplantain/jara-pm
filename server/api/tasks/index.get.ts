import { taskQuerySchema } from '#shared/schemas/task'
import { listTasks } from '~~/server/services/tasks'
import { requireUser } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const query = await getValidatedQuery(event, taskQuerySchema.parse)
  return listTasks(useDatabase(event), user.id, query)
})
