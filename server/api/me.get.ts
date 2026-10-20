import { getWorkspaceDetails, requireMember } from '~~/server/utils/auth'

export default defineEventHandler(async (event) => {
  const member = await requireMember(event)
  const workspace = getWorkspaceDetails(event, member.workspaceId, member.user.id)
  if (!workspace) throw createError({ status: 403, statusText: 'Workspace is not available' })
  return { ...member.user, workspace }
})
