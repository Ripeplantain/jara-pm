import { listWorkspaces } from '~~/server/services/workspace'
import { requireUser } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  return listWorkspaces(useDatabase(event), user.id)
})
