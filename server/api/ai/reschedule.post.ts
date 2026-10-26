import { rescheduleRequestSchema } from '#shared/schemas/ai'
import { PROMPT_VERSION, rescheduleOverdue } from '~~/server/services/ai'
import { requireMember } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'
import { captureServerEvent } from '~~/server/utils/posthog'

export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireMember(event)
  await readValidatedBody(event, body => rescheduleRequestSchema.parse(body ?? {}))
  const config = useRuntimeConfig(event)
  const reply = await rescheduleOverdue(useDatabase(event), user.id, workspaceId, {
    apiKey: String(config.llm.apiKey),
    baseUrl: String(config.llm.baseUrl),
    model: String(config.llm.model),
  })
  captureServerEvent(event, user.id, 'ask_kobi_reschedule_requested', {
    has_proposal: Boolean(reply.proposal),
    reply_source: reply.source,
    prompt_version: PROMPT_VERSION,
    change_count: reply.proposal?.changes.length ?? 0,
  })
  return reply
})
