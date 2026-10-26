import { idParamsSchema } from '#shared/schemas/query'
import { undoReschedule } from '~~/server/services/ai'
import { requireMember } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'
import { captureServerEvent } from '~~/server/utils/posthog'

export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireMember(event)
  const { id } = await getValidatedRouterParams(event, idParamsSchema.parse)
  const result = undoReschedule(useDatabase(event), user.id, workspaceId, id)
  captureServerEvent(event, user.id, 'ask_kobi_reschedule_undone', { change_count: result.taskIds.length })
  return result
})
