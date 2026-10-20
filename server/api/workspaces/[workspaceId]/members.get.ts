import { workspaceParamsSchema } from '#shared/schemas/workspace'
import { listWorkspaceMembers } from '~~/server/services/workspace'
import { requireWorkspaceMember } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'

export default defineEventHandler(async (event) => {
  const { workspaceId } = await getValidatedRouterParams(event, workspaceParamsSchema.parse)
  await requireWorkspaceMember(event, workspaceId)
  return listWorkspaceMembers(useDatabase(event), workspaceId)
})
