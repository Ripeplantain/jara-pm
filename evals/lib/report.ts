// Run records. Every run - offline or paid - records the model id, the
// resolved provider endpoint, PROMPT_VERSION, prompt and completion tokens and
// the estimated cost, as .agent/rules/evals.md requires.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MAX_REPLY_TOKENS, PROMPT_VERSION } from '~~/server/services/ai'
import { estimateCost, pricingFor } from './cost'
import type { Check } from './graders'

export type CaseRow = {
  caseId: string
  group: string
  classification: string
  passed: boolean
  clean: boolean
  failing: string[]
  checks: Check[]
  counts: { projects: number, milestones: number, tasks: number, longestTitle: number } | null
  promptTokens: number
  completionTokens: number
  /** completionTokens as a share of MAX_REPLY_TOKENS. */
  tokenCeilingUse: number
  hitTokenCeiling: boolean
  provider: string
  latencyMs: number
  infrastructureFailure: string | null
}

export type RunRecord = {
  mode: 'offline-fixtures' | 'live'
  model: string
  resolvedProviders: string[]
  promptVersion: string
  /**
   * MAX_REPLY_TOKENS at run time. Records written before 2026-10-19 carry the
   * same value under the old name `goalPlanMaxTokens`, from when the ceiling
   * was goal-plan-specific; a comparison across that boundary must read either
   * key. Nothing reads stored records today, so no existing file is broken.
   */
  maxReplyTokens: number
  pricingUsdPerMillion: { input: number, output: number } | null
  startedAt: string
  cases: number
  passed: number
  clean: number
  passRate: number
  promptTokens: number
  completionTokens: number
  maxCompletionTokens: number
  truncatedByBudget: number
  estimatedCostUsd: number | null
  infrastructureFailures: number
  rows: CaseRow[]
}

export const buildRunRecord = (mode: RunRecord['mode'], model: string, rows: CaseRow[]): RunRecord => {
  const promptTokens = rows.reduce((total, row) => total + row.promptTokens, 0)
  const completionTokens = rows.reduce((total, row) => total + row.completionTokens, 0)
  const passed = rows.filter(row => row.passed).length
  return {
    mode,
    model,
    resolvedProviders: [...new Set(rows.map(row => row.provider).filter(provider => provider && provider !== 'n/a'))].sort(),
    promptVersion: PROMPT_VERSION,
    maxReplyTokens: MAX_REPLY_TOKENS,
    pricingUsdPerMillion: pricingFor(model),
    startedAt: new Date().toISOString(),
    cases: rows.length,
    passed,
    clean: rows.filter(row => row.clean).length,
    passRate: rows.length ? passed / rows.length : 0,
    promptTokens,
    completionTokens,
    maxCompletionTokens: rows.length ? Math.max(...rows.map(row => row.completionTokens)) : 0,
    truncatedByBudget: rows.filter(row => row.hitTokenCeiling).length,
    estimatedCostUsd: estimateCost(model, promptTokens, completionTokens),
    infrastructureFailures: rows.filter(row => row.infrastructureFailure).length,
    rows,
  }
}

const resultsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'results')

export const writeRunRecord = (record: RunRecord) => {
  mkdirSync(resultsDir, { recursive: true })
  const slug = `${record.startedAt.replace(/[:.]/g, '-')}-${record.mode}-${record.model.replace(/[^a-z0-9]+/gi, '-')}`
  const path = join(resultsDir, `${slug}.json`)
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`)
  return path
}

const money = (value: number | null) => (value === null ? 'unpriced' : `$${value.toFixed(4)}`)

export const printRunRecord = (record: RunRecord, path: string) => {
  const lines = [
    '',
    `model            ${record.model}`,
    `mode             ${record.mode}`,
    `provider(s)      ${record.resolvedProviders.length ? record.resolvedProviders.join(', ') : 'n/a (offline)'}`,
    `prompt version   ${record.promptVersion}`,
    `cases            ${record.cases}`,
    `passed           ${record.passed}/${record.cases} (${(record.passRate * 100).toFixed(0)}%), clean ${record.clean}`,
    `tokens           ${record.promptTokens} prompt / ${record.completionTokens} completion (max ${record.maxCompletionTokens} of ${record.maxReplyTokens})`,
    `truncated        ${record.truncatedByBudget} case(s) hit the completion ceiling`,
    `infra failures   ${record.infrastructureFailures}`,
    `estimated cost   ${money(record.estimatedCostUsd)}`,
    `record           ${path}`,
    '',
  ]
  for (const row of record.rows) {
    const flag = row.passed ? (row.clean ? 'pass ' : 'pass*') : 'FAIL '
    const tokens = row.completionTokens ? ` ${row.completionTokens}tok${row.hitTokenCeiling ? ' CEILING' : ''}` : ''
    const counts = row.counts ? ` [${row.counts.projects}p/${row.counts.milestones}m/${row.counts.tasks}t]` : ''
    lines.push(`  ${flag} ${row.caseId.padEnd(32)} ${row.classification.padEnd(19)}${counts}${tokens}${row.failing.length ? ` failing: ${row.failing.join(',')}` : ''}${row.infrastructureFailure ? ` INFRA: ${row.infrastructureFailure}` : ''}`)
  }
  console.info(lines.join('\n'))
}
