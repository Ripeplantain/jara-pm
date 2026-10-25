import { listStatuses } from '~~/server/services/statuses'
import { requireMember } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'

export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireMember(event)
  return listStatuses(useDatabase(event), workspaceId)
})
