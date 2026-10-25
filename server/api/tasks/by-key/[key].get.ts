import { z } from 'zod'
import { getTaskByKey } from '~~/server/services/tasks'
import { requireMember } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'

// The key is matched loosely here and parsed by the service, so an unknown or malformed key
// resolves to 404 rather than a validation 400 -- a stale `ACME-99` link is a missing task,
// not a bad request.
const paramsSchema = z.object({ key: z.string().trim().min(1).max(32) })

export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireMember(event)
  const { key } = await getValidatedRouterParams(event, paramsSchema.parse)
  return getTaskByKey(useDatabase(event), user.id, workspaceId, key)
})
