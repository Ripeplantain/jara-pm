// The paid side of the harness. Phase 2 only: nothing here runs unless
// KOBI_EVAL_LIVE=1 is set, and the model id and API key both come from the
// environment at run time. No key, model id or .env path is hardcoded, and
// this file never reads a .env file.

import { buildProviderRequest, MAX_REPLY_TOKENS, type HistoryTurn } from '~~/server/services/ai'
import type { EvalContext } from '../cases'

export type LiveConfig = {
  apiKey: string
  baseUrl: string
  model: string
}

/** Reads run-time configuration. Returns a reason instead of throwing. */
export const readLiveConfig = (): { ok: true, config: LiveConfig } | { ok: false, reason: string } => {
  if (process.env.KOBI_EVAL_LIVE !== '1') return { ok: false, reason: 'KOBI_EVAL_LIVE is not 1 (offline by default, so no paid call can happen by accident)' }
  const model = process.env.KOBI_EVAL_MODEL ?? ''
  if (!model) return { ok: false, reason: 'KOBI_EVAL_MODEL is not set' }
  const apiKey = process.env.KOBI_EVAL_API_KEY ?? process.env.NUXT_LLM_API_KEY ?? ''
  if (!apiKey) return { ok: false, reason: 'KOBI_EVAL_API_KEY (or NUXT_LLM_API_KEY) is not set' }
  const baseUrl = process.env.NUXT_LLM_BASE_URL ?? 'https://openrouter.ai/api/v1'
  return { ok: true, config: { apiKey, baseUrl, model } }
}

export type LiveSuccess = {
  ok: true
  content: string
  promptTokens: number
  completionTokens: number
  /** OpenRouter reports the endpoint that actually served the call. */
  provider: string
  finishReason: string
  /** finishReason === 'length', i.e. the reply hit MAX_REPLY_TOKENS. */
  hitTokenCeiling: boolean
  latencyMs: number
}

/**
 * Infrastructure failures are NOT model-quality signals and are reported
 * separately: 402 means the budget-limited key refused the reservation,
 * 401 a bad key, 429 rate limiting, anything else a transport problem.
 */
export type LiveFailure = {
  ok: false
  kind: 'budget' | 'auth' | 'rate_limit' | 'transport' | 'envelope'
  status?: number
  detail: string
}

const classifyStatus = (status: number): LiveFailure['kind'] => {
  if (status === 402) return 'budget'
  if (status === 401 || status === 403) return 'auth'
  if (status === 429) return 'rate_limit'
  return 'transport'
}

/**
 * One Ask Kobi call. The request body is produced by the product's own
 * `buildProviderRequest`, so max_tokens, provider.require_parameters,
 * response_format and the prompt are exactly what the app sends.
 */
export const callModel = async (
  config: LiveConfig,
  message: string,
  context: EvalContext,
  history: HistoryTurn[] = [],
): Promise<LiveSuccess | LiveFailure> => {
  const body = buildProviderRequest(
    { apiKey: config.apiKey, baseUrl: config.baseUrl, model: config.model },
    message,
    context as never,
    history,
  )
  // Guard against a harness-side change making the comparison invalid.
  if (body.max_tokens !== MAX_REPLY_TOKENS) {
    return { ok: false, kind: 'envelope', detail: `max_tokens was ${body.max_tokens}, expected ${MAX_REPLY_TOKENS}` }
  }

  const startedAt = Date.now()
  let response: Response
  try {
    response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    })
  } catch (error) {
    return { ok: false, kind: 'transport', detail: error instanceof Error ? error.message : 'fetch failed' }
  }
  const latencyMs = Date.now() - startedAt

  const text = await response.text()
  if (!response.ok) {
    return { ok: false, kind: classifyStatus(response.status), status: response.status, detail: text.slice(0, 400) }
  }

  let payload: {
    choices?: Array<{ message?: { content?: string }, finish_reason?: string }>
    usage?: { prompt_tokens?: number, completion_tokens?: number }
    provider?: string
  }
  try {
    payload = JSON.parse(text) as typeof payload
  } catch {
    return { ok: false, kind: 'envelope', detail: `response body was not JSON: ${text.slice(0, 200)}` }
  }
  const content = payload.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content) {
    return { ok: false, kind: 'envelope', detail: `no content in choices[0]: ${text.slice(0, 200)}` }
  }
  const finishReason = payload.choices?.[0]?.finish_reason ?? 'unknown'
  return {
    ok: true,
    content,
    promptTokens: payload.usage?.prompt_tokens ?? 0,
    completionTokens: payload.usage?.completion_tokens ?? 0,
    provider: payload.provider ?? 'unreported',
    finishReason,
    hitTokenCeiling: finishReason === 'length',
    latencyMs,
  }
}
