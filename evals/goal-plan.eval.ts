// PHASE 2: the paid goal-plan run. One model per invocation, one call per case (18).
//
// Skipped unless KOBI_EVAL_LIVE=1, so neither `vitest run` nor the offline
// eval command can spend money. The model id and the API key are read from the
// environment at run time; nothing is hardcoded and no .env file is read.
//
//   KOBI_EVAL_LIVE=1 KOBI_EVAL_MODEL=<model> KOBI_EVAL_API_KEY=<key> \
//     ./node_modules/.bin/vitest run --config evals/vitest.config.ts goal-plan

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MAX_REPLY_TOKENS } from '~~/server/services/ai'
import { baseContext, goalPlanCases } from './cases'
import { classifyContent, gradeReply } from './lib/graders'
import { callModel, readLiveConfig } from './lib/provider'
import { buildRunRecord, printRunRecord, writeRunRecord, type CaseRow } from './lib/report'

// One call per case, one model per invocation. Anything above 50 paid calls in
// a single command is a checkpoint (.agent/rules/checkpoints.md), so the
// harness refuses rather than asking forgiveness.
const MAX_CALLS_PER_RUN = 50

const live = readLiveConfig()
if (!live.ok) {
  console.info(`[evals] live goal-plan run skipped (no paid calls): ${live.reason}`)
}

describe.runIf(live.ok)('live goal-plan run', () => {
  const config = live.ok ? live.config : null
  const rows = new Map<string, CaseRow>()

  beforeAll(async () => {
    if (!config) return
    if (goalPlanCases.length > MAX_CALLS_PER_RUN) {
      throw new Error(`${goalPlanCases.length} cases would exceed the ${MAX_CALLS_PER_RUN}-call checkpoint in one command`)
    }
    // Sequential on purpose: free-tier keys rate-limit concurrent calls, and a
    // 429 would read as a model failure.
    for (const evalCase of goalPlanCases) {
      const result = await callModel(config, evalCase.message, evalCase.context ?? baseContext, evalCase.history)
      if (!result.ok) {
        rows.set(evalCase.id, {
          caseId: evalCase.id,
          group: evalCase.group,
          classification: `infra:${result.kind}`,
          passed: false,
          clean: false,
          failing: [],
          checks: [],
          counts: null,
          promptTokens: 0,
          completionTokens: 0,
          tokenCeilingUse: 0,
          hitTokenCeiling: false,
          provider: 'none',
          latencyMs: 0,
          infrastructureFailure: `${result.kind}${result.status ? ` (${result.status})` : ''}: ${result.detail}`,
        })
        continue
      }
      const classification = classifyContent(result.content)
      const grade = gradeReply(evalCase, classification)
      rows.set(evalCase.id, {
        caseId: evalCase.id,
        group: evalCase.group,
        classification: classification.kind,
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
  })

  it.each(goalPlanCases.map(evalCase => [evalCase.id, evalCase.grades] as const))('%s - %s', (caseId) => {
    const row = rows.get(caseId)
    expect(row, `no result recorded for ${caseId}`).toBeDefined()
    // An infrastructure failure is reported, never scored as model quality.
    expect(row!.infrastructureFailure, `infrastructure failure, not a quality signal: ${row!.infrastructureFailure}`).toBeNull()
    expect(
      row!.failing.filter(id => id !== 'relevance'),
      row!.checks.map(check => `${check.id}=${check.passed ? 'ok' : 'FAIL'} (${check.severity}): ${check.detail}`).join('\n'),
    ).toEqual([])
  })

  afterAll(() => {
    if (!config || !rows.size) return
    const record = buildRunRecord('live', config.model, [...rows.values()])
    printRunRecord(record, writeRunRecord(record))
  })
})
