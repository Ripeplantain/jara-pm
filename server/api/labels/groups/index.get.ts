import { listLabelGroups } from '~~/server/services/labels'
import { requireMember } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'

export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireMember(event)
  return listLabelGroups(useDatabase(event), workspaceId)
})
