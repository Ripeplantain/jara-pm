// PHASE 1: validates the paid path without paying for it. `fetch` is stubbed,
// so these assertions cover request shaping, usage/provider/finish_reason
// parsing, infrastructure-failure classification, cost arithmetic and the run
// record - everything phase 2 relies on. Zero network calls, zero cost.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_REPLY_TOKENS, PROMPT_VERSION } from '~~/server/services/ai'
import { baseContext, goalPlanCases } from './cases'
import { fixtures } from './fixtures'
import { estimateCost, pricingFor } from './lib/cost'
import { classifyContent, gradeReply } from './lib/graders'
import { callModel } from './lib/provider'
import { buildRunRecord, type CaseRow } from './lib/report'

const config = { apiKey: 'stub-key-not-a-real-credential', baseUrl: 'https://openrouter.ai/api/v1', model: 'vendor/model-under-test' }

const envelope = (content: string, extra: Record<string, unknown> = {}) => ({
  provider: 'StubProvider',
  usage: { prompt_tokens: 1024, completion_tokens: 1800 },
  choices: [{ message: { content }, finish_reason: 'stop' }],
  ...extra,
})

type FetchHandler = (url: string, init: RequestInit) => Response | Promise<Response>

const stubFetch = (handler: FetchHandler) => {
  const spy = vi.fn<FetchHandler>(handler)
  vi.stubGlobal('fetch', spy)
  return spy
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the live call sends exactly what the product sends', () => {
  it('posts the product request body with the run-time model and key', async () => {
    const spy = stubFetch(() => jsonResponse(envelope(fixtures.find(fixture => fixture.id === 'valid-plan')!.content)))

    const result = await callModel(config, 'learn Spanish', baseContext)

    expect(result.ok).toBe(true)
    expect(spy).toHaveBeenCalledTimes(1)
    const [url, init] = spy.mock.calls[0]!
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${config.apiKey}`)

    const body = JSON.parse(init.body as string) as Record<string, never>
    expect(body.model).toBe('vendor/model-under-test')
    expect(body.max_tokens).toBe(MAX_REPLY_TOKENS)
    expect(body.provider).toEqual({ require_parameters: true })
    expect(body.temperature).toBe(0.2)
    expect(body.response_format).toMatchObject({ type: 'json_schema', json_schema: { name: 'kobi_ai_reply', strict: true } })
    expect(JSON.stringify(body.messages)).toContain(PROMPT_VERSION)
    // The key must never reach the request body.
    expect(JSON.stringify(body)).not.toContain(config.apiKey)
  })

  it('records tokens, the resolved provider and the completion ceiling', async () => {
    stubFetch(() => jsonResponse(envelope('{"message":"x","proposal":null}', {
      provider: 'DeepInfra',
      usage: { prompt_tokens: 980, completion_tokens: 3000 },
      choices: [{ message: { content: '{"message":"x","proposal":null}' }, finish_reason: 'length' }],
    })))

    const result = await callModel(config, 'get fit', baseContext)

    expect(result.ok && result.provider).toBe('DeepInfra')
    expect(result.ok && result.promptTokens).toBe(980)
    expect(result.ok && result.completionTokens).toBe(3000)
    // finish_reason 'length' is the direct signal that the 3000-token budget
    // cut the reply off, which is failure mode 1.
    expect(result.ok && result.hitTokenCeiling).toBe(true)
  })
})

describe('infrastructure failures are separated from model quality', () => {
  it.each([
    [402, 'budget'],
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate_limit'],
    [500, 'transport'],
  ] as const)('maps HTTP %i to %s', async (status, kind) => {
    stubFetch(() => jsonResponse({ error: { message: 'nope' } }, status))

    const result = await callModel(config, 'get fit', baseContext)

    expect(result.ok).toBe(false)
    expect(!result.ok && result.kind).toBe(kind)
    expect(!result.ok && result.status).toBe(status)
  })

  it('maps a network error and a malformed envelope without scoring the model', async () => {
    stubFetch(() => { throw new Error('socket hang up') })
    expect(!(await callModel(config, 'get fit', baseContext)).ok).toBe(true)

    vi.unstubAllGlobals()
    stubFetch(() => jsonResponse({ choices: [] }))
    const malformed = await callModel(config, 'get fit', baseContext)
    expect(!malformed.ok && malformed.kind).toBe('envelope')
  })
})

describe('cost reporting', () => {
  it('prices the listed models and refuses to guess for anything else', () => {
    expect(pricingFor('openai/gpt-4.1-mini')).toEqual({ input: 0.40, output: 1.60 })
    expect(pricingFor('openai/gpt-4.1')).toEqual({ input: 2.00, output: 8.00 })
    expect(pricingFor('deepseek/deepseek-v3.2')).toEqual({ input: 0.28, output: 0.42 })
    expect(pricingFor('deepseek/deepseek-v4.1-flash')).toEqual({ input: 0.30, output: 1.20 })
    expect(pricingFor('vendor/not-listed')).toBeNull()
    expect(estimateCost('vendor/not-listed', 1000, 3000)).toBeNull()
  })

  it('computes cost from prompt and completion tokens', () => {
    // 1000 prompt + 3000 completion at $0.28/$0.42 per M.
    expect(estimateCost('deepseek/deepseek-v3.2', 1000, 3000)).toBeCloseTo(0.00154, 6)
    expect(estimateCost('openai/gpt-4.1', 1000, 3000)).toBeCloseTo(0.026, 6)
    expect(estimateCost('openai/gpt-4.1-mini', 1000, 3000)).toBeCloseTo(0.0052, 6)
  })
})

describe('a full 18-case run, end to end, against stubbed replies', () => {
  it('makes one call per case and produces a complete run record', async () => {
    const good = fixtures.find(fixture => fixture.id === 'valid-plan')!.content
    const vague = fixtures.find(fixture => fixture.id === 'vague-handled-correctly')!.content
    const spy = stubFetch((_url, init) => {
      const body = JSON.parse(init.body as string) as { messages: Array<{ role: string, content: string }> }
      const message = body.messages.at(-1)?.content ?? ''
      const vagueCase = goalPlanCases.find(evalCase => evalCase.message === message)?.expect === 'question'
      return jsonResponse(envelope(vagueCase ? vague : good))
    })

    const rows: CaseRow[] = []
    for (const evalCase of goalPlanCases) {
      const result = await callModel(config, evalCase.message, evalCase.context ?? baseContext, evalCase.history)
      expect(result.ok).toBe(true)
      if (!result.ok) continue
      const grade = gradeReply(evalCase, classifyContent(result.content))
      rows.push({
        caseId: evalCase.id,
        group: evalCase.group,
        classification: 'valid',
        passed: grade.passed,
        clean: grade.clean,
        failing: grade.checks.filter(check => !check.passed).map(check => check.id),
        checks: grade.checks,
        counts: grade.counts,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        tokenCeilingUse: result.completionTokens / MAX_REPLY_TOKENS,
        hitTokenCeiling: result.hitTokenCeiling,
        provider: result.provider,
        latencyMs: result.latencyMs,
        infrastructureFailure: null,
      })
    }

    // Exactly 18 calls, one per case, under the 50-call checkpoint.
    expect(spy).toHaveBeenCalledTimes(18)
    expect(rows).toHaveLength(18)

    const record = buildRunRecord('live', 'deepseek/deepseek-v4.1-flash', rows)
    expect(record.promptVersion).toBe(PROMPT_VERSION)
    expect(record.maxReplyTokens).toBe(3000)
    expect(record.resolvedProviders).toEqual(['StubProvider'])
    expect(record.promptTokens).toBe(18 * 1024)
    expect(record.completionTokens).toBe(18 * 1800)
    expect(record.estimatedCostUsd).toBeCloseTo((18 * 1024 * 0.30 + 18 * 1800 * 1.20) / 1_000_000, 8)
    expect(record.infrastructureFailures).toBe(0)
    // Every case is scored; the stubbed replies are only topical for the
    // Spanish case, so the minor pattern grader is expected to fire elsewhere.
    expect(record.rows.every(row => row.checks.length > 0)).toBe(true)
    expect(record.rows.filter(row => row.failing.includes('relevance')).length).toBeGreaterThan(0)
  })
})
