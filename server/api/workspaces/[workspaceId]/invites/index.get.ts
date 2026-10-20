import { workspaceParamsSchema } from '#shared/schemas/workspace'
import { listPendingInvites } from '~~/server/services/workspace-invites'
import { requireWorkspaceOwner } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'

export default defineEventHandler(async (event) => {
  const { workspaceId } = await getValidatedRouterParams(event, workspaceParamsSchema.parse)
  await requireWorkspaceOwner(event, workspaceId)
  return listPendingInvites(useDatabase(event), workspaceId)
})
