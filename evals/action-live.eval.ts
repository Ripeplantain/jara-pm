// PHASE 2: the paid triage / reschedule / breakdown run. One model per invocation, one call per
// action case (13).
//
// Skipped unless KOBI_EVAL_LIVE=1, so neither `vitest run` nor the offline eval command can
// spend money. The model id and the API key are read from the environment at run time; nothing
// is hardcoded and no .env file is read.
//
//   KOBI_EVAL_LIVE=1 KOBI_EVAL_MODEL=<model> KOBI_EVAL_API_KEY=<key> \
//     ./node_modules/.bin/vitest run --config evals/vitest.config.ts action-live

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MAX_REPLY_TOKENS } from '~~/server/services/ai'
import { actionCases } from './action-cases'
import { classifyActionContent, gradeActionReply } from './lib/action-graders'
import { callActionModel, readLiveConfig } from './lib/provider'
import { buildRunRecord, printRunRecord, writeRunRecord, type CaseRow } from './lib/report'

// One call per case, one model per invocation. Anything above 50 paid calls in a single command
// is a checkpoint (.agent/rules/checkpoints.md), so the harness refuses rather than asking
// forgiveness.
const MAX_CALLS_PER_RUN = 50

const live = readLiveConfig()
if (!live.ok) {
  console.info(`[evals] live action run skipped (no paid calls): ${live.reason}`)
}

describe.runIf(live.ok)('live action run', () => {
  const config = live.ok ? live.config : null
  const rows = new Map<string, CaseRow>()

  beforeAll(async () => {
    if (!config) return
    if (actionCases.length > MAX_CALLS_PER_RUN) {
      throw new Error(`${actionCases.length} cases would exceed the ${MAX_CALLS_PER_RUN}-call checkpoint in one command`)
    }
    // Sequential on purpose: free-tier keys rate-limit concurrent calls, and a 429 would read as
    // a model failure.
    for (const evalCase of actionCases) {
      const result = await callActionModel(config, evalCase.kind, evalCase.context)
      if (!result.ok) {
        rows.set(evalCase.id, {
          caseId: evalCase.id,
          group: evalCase.kind,
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
      const classification = classifyActionContent(evalCase.kind, result.content)
      const grade = gradeActionReply(evalCase, classification)
      rows.set(evalCase.id, {
        caseId: evalCase.id,
        group: evalCase.kind,
        classification: classification.kind,
        passed: grade.passed,
        clean: grade.checks.every(check => check.passed),
        failing: grade.checks.filter(check => !check.passed).map(check => check.id),
        checks: grade.checks,
        counts: null,
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

  it.each(actionCases.map(evalCase => [evalCase.id, evalCase.grades] as const))('%s - %s', (caseId) => {
    const row = rows.get(caseId)
    expect(row, `no result recorded for ${caseId}`).toBeDefined()
    // An infrastructure failure is reported, never scored as model quality.
    expect(row!.infrastructureFailure, `infrastructure failure, not a quality signal: ${row!.infrastructureFailure}`).toBeNull()
    expect(
      row!.checks.filter(check => !check.passed && check.severity !== 'minor').map(check => check.id),
      row!.checks.map(check => `${check.id}=${check.passed ? 'ok' : 'FAIL'} (${check.severity}): ${check.detail}`).join('\n'),
    ).toEqual([])
  })

  afterAll(() => {
    if (!config || !rows.size) return
    const record = buildRunRecord('live', config.model, [...rows.values()])
    printRunRecord(record, writeRunRecord(record))
  })
})
