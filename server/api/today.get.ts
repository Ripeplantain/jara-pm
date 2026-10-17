import { getToday } from '~~/server/services/dashboard'
import { requireUser } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  return getToday(useDatabase(event), user.id)
})
