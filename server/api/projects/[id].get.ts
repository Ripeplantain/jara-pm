import { idParamsSchema } from '#shared/schemas/query'
import { getProject } from '~~/server/services/projects'
import { listTasks } from '~~/server/services/tasks'
import { requireMember } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'

export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireMember(event)
  const { id } = await getValidatedRouterParams(event, idParamsSchema.parse)
  const db = useDatabase(event)
  return {
    project: getProject(db, user.id, workspaceId, id),
    tasks: listTasks(db, user.id, workspaceId, { scope: 'all', projectId: id }),
  }
})
