import { taskQuerySchema } from '#shared/schemas/task'
import { listTasks } from '~~/server/services/tasks'
import { requireMember } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'

export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireMember(event)
  const query = await getValidatedQuery(event, taskQuerySchema.parse)
  return listTasks(useDatabase(event), user.id, workspaceId, query)
})
