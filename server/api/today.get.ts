import { getToday } from '~~/server/services/dashboard'
import { requireMember } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'

export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireMember(event)
  return getToday(useDatabase(event), user.id, workspaceId)
})
