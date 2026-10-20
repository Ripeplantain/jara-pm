import { inspectInvite } from '~~/server/services/workspace-invites'
import { useDatabase } from '~~/server/utils/database'

export default defineEventHandler((event) => {
  const token = getRouterParam(event, 'token')
  if (!token) throw createError({ status: 400, statusText: 'Invite token is required' })
  return inspectInvite(useDatabase(event), token)
})
