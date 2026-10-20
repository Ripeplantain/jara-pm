import { listWorkspaceMembers } from '~~/server/services/workspace'
import { requireMember } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'

export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireMember(event)
  return listWorkspaceMembers(useDatabase(event), workspaceId)
})
