import { askKobiSchema } from '#shared/schemas/ai'
import { askKobi } from '~~/server/services/ai'
import { requireUser } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const body = await readValidatedBody(event, askKobiSchema.parse)
  const config = useRuntimeConfig(event)
  return askKobi(useDatabase(event), user.id, body, {
    apiKey: String(config.llm.apiKey),
    baseUrl: String(config.llm.baseUrl),
    model: String(config.llm.model),
  })
})
