import { breakdownRequestSchema } from '#shared/schemas/ai'
import { breakdownProject, PROMPT_VERSION } from '~~/server/services/ai'
import { requireMember } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'
import { captureServerEvent } from '~~/server/utils/posthog'

export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireMember(event)
  const body = await readValidatedBody(event, breakdownRequestSchema.parse)
  const config = useRuntimeConfig(event)
  const reply = await breakdownProject(useDatabase(event), user.id, workspaceId, body, {
    apiKey: String(config.llm.apiKey),
    baseUrl: String(config.llm.baseUrl),
    model: String(config.llm.model),
  })
  captureServerEvent(event, user.id, 'ask_kobi_breakdown_requested', {
    has_proposal: Boolean(reply.proposal),
    reply_source: reply.source,
    prompt_version: PROMPT_VERSION,
    milestone_count: reply.proposal?.milestones.length ?? 0,
  })
  return reply
})
