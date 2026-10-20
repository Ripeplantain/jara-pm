import { listPendingInvites } from '~~/server/services/workspace-invites'
import { requireOwner } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'

export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireOwner(event)
  return listPendingInvites(useDatabase(event), workspaceId)
})
