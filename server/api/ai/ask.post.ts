import { askKobiSchema } from '#shared/schemas/ai'
import { askKobi, PROMPT_VERSION } from '~~/server/services/ai'
import { requireMember } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'
import { captureServerEvent } from '~~/server/utils/posthog'

export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireMember(event)
  const body = await readValidatedBody(event, askKobiSchema.parse)
  const config = useRuntimeConfig(event)
  const { historyTurns, ...reply } = await askKobi(useDatabase(event), user.id, workspaceId, body, {
    apiKey: String(config.llm.apiKey),
    baseUrl: String(config.llm.baseUrl),
    model: String(config.llm.model),
  })
  captureServerEvent(event, user.id, 'ask_kobi_message_sent', {
    has_proposal: Boolean(reply.proposal),
    reply_source: reply.source,
    prompt_version: PROMPT_VERSION,
    history_turns: historyTurns,
    message_chars: body.message.length,
  })
  return reply
})
