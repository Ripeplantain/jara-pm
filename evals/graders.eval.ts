// PHASE 1: validates the harness itself. Zero network calls, zero cost.
//
// Three jobs:
//  1. every fixture reply is classified and graded exactly as declared;
//  2. the request the harness would send is the product's own request;
//  3. the harness cannot persist anything.

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { buildProviderRequest, MAX_REPLY_TOKENS, PROMPT_VERSION } from '~~/server/services/ai'
import { baseContext, goalPlanCases } from './cases'
import { fixtures } from './fixtures'
import { classifyContent, gradeReply } from './lib/graders'
import { buildRunRecord, printRunRecord, writeRunRecord, type CaseRow } from './lib/report'

const caseById = new Map(goalPlanCases.map(evalCase => [evalCase.id, evalCase]))
const rows: CaseRow[] = []

describe('eval case set', () => {
  it('has 18 unique cases spanning every required group', () => {
    expect(goalPlanCases).toHaveLength(18)
    expect(new Set(goalPlanCases.map(evalCase => evalCase.id)).size).toBe(18)
    const groups = goalPlanCases.reduce<Record<string, number>>((totals, evalCase) => {
      totals[evalCase.group] = (totals[evalCase.group] ?? 0) + 1
      return totals
    }, {})
    expect(groups).toEqual({ terse: 3, large: 3, vague: 3, bounds: 1, injection: 2, chat: 3, history: 3 })
    // Vague messages get one question, chat gets an answer; every history case
    // carries history.
    for (const evalCase of goalPlanCases) {
      if (evalCase.group === 'vague') expect(evalCase.expect).toBe('question')
      else if (evalCase.group === 'chat') expect(evalCase.expect).toBe('answer')
      else if (evalCase.group !== 'history') expect(evalCase.expect).toBe('plan')
      expect(Boolean(evalCase.history?.length)).toBe(evalCase.group === 'history')
    }
  })

  it('keeps every message inside the request bound the API enforces', () => {
    for (const evalCase of goalPlanCases) {
      expect(evalCase.message.trim().length).toBeGreaterThan(0)
      expect(evalCase.message.length).toBeLessThan(16_000)
    }
  })
})

describe('the harness sends the product request unchanged', () => {
  const buildFor = (message: string, context: unknown, history: Array<{ role: 'user' | 'assistant', content: string }> = []) => buildProviderRequest(
    { apiKey: 'unused-in-phase-1', baseUrl: 'https://openrouter.ai/api/v1', model: 'model-under-test' },
    message,
    context as never,
    history,
  )
  const fixedSystemInstruction = buildFor('a message no case uses', baseContext).messages[0]?.content

  it.each(goalPlanCases.map(evalCase => evalCase.id))('builds the real request for %s', (caseId) => {
    const evalCase = caseById.get(caseId)!
    const request = buildFor(evalCase.message, evalCase.context ?? baseContext, evalCase.history)

    expect(request.model).toBe('model-under-test')
    expect(request.max_tokens).toBe(MAX_REPLY_TOKENS)
    expect(MAX_REPLY_TOKENS).toBe(3000)
    expect(request.reasoning).toEqual({ enabled: false })
    expect(request.provider.require_parameters).toBe(true)
    expect(request.response_format.json_schema.strict).toBe(true)
    expect(request.messages[0]?.content).toContain(PROMPT_VERSION)
    // The instructions are fixed: they never vary with the user message, so no
    // case can smuggle text into the system role. (A literal
    // `not.toContain(message)` would be wrong here - REPLY_INSTRUCTION names
    // "get fit" and "learn Spanish" as examples in the prompt itself.)
    expect(request.messages[0]?.content).toBe(fixedSystemInstruction)
    // The application context is fenced into its own later message.
    expect(request.messages[1]?.content.startsWith('UNTRUSTED_APPLICATION_CONTEXT\n')).toBe(true)
    expect(request.messages[1]?.content).not.toContain(evalCase.message)
    expect(request.messages.at(-1)).toEqual({ role: 'user', content: evalCase.message })
    expect(request.messages.filter(message => message.role === 'user')).toHaveLength(1)
    expect(request.messages.some(message => message.role === ('assistant' as string))).toBe(false)
  })

  it.each(goalPlanCases.filter(evalCase => evalCase.history?.length).map(evalCase => evalCase.id))('fences the history of %s and keeps it out of the instruction and native roles', (caseId) => {
    const evalCase = caseById.get(caseId)!
    const request = buildFor(evalCase.message, evalCase.context ?? baseContext, evalCase.history)
    const fence = request.messages.find(message => message.content.startsWith('UNTRUSTED_CONVERSATION_HISTORY\n'))

    expect(fence?.role).toBe('system')
    expect(fence?.content.endsWith('\nEND_HISTORY')).toBe(true)
    for (const turn of evalCase.history!) expect(fence?.content).toContain(JSON.stringify(turn.content).slice(1, -1))
    expect(request.messages[0]?.content).toBe(fixedSystemInstruction)
    expect(request.messages.some(message => message.role === ('assistant' as string))).toBe(false)
    expect(request.messages.at(-1)?.role).toBe('user')
  })

  it('keeps a context-borne injection payload out of the system instructions', () => {
    const injection = caseById.get('injection-in-context')!
    const request = buildFor(injection.message, injection.context)

    expect(request.messages[0]?.content).not.toContain('SYSTEM OVERRIDE')
    expect(request.messages[1]?.content).toContain('SYSTEM OVERRIDE')
  })
})

describe('graders classify every fixture correctly', () => {
  it.each(fixtures.map(fixture => [fixture.id, fixture.why] as const))('%s - %s', (fixtureId) => {
    const fixture = fixtures.find(candidate => candidate.id === fixtureId)!
    const evalCase = caseById.get(fixture.caseId)
    expect(evalCase, `fixture ${fixture.id} references unknown case ${fixture.caseId}`).toBeDefined()

    const classification = classifyContent(fixture.content)
    expect(classification.kind, fixture.why).toBe(fixture.expectClassification)

    const grade = gradeReply(evalCase!, classification)
    const failing = grade.checks.filter(check => !check.passed).map(check => check.id).sort()
    expect(failing, grade.checks.map(check => `${check.id}=${check.passed ? 'ok' : 'FAIL'}: ${check.detail}`).join('\n'))
      .toEqual([...fixture.expectFailing].sort())
    expect(grade.passed).toBe(fixture.expectFailing.every(id => id === 'relevance'))

    rows.push({
      caseId: `${fixture.caseId} <- ${fixture.id}`,
      group: evalCase!.group,
      classification: classification.kind,
      passed: grade.passed,
      clean: grade.clean,
      failing,
      checks: grade.checks,
      counts: grade.counts,
      promptTokens: 0,
      completionTokens: 0,
      tokenCeilingUse: 0,
      hitTokenCeiling: false,
      provider: 'n/a',
      latencyMs: 0,
      infrastructureFailure: null,
    })
  })

  it('reports the maxima for a plan sitting exactly on the schema bounds', () => {
    const fixture = fixtures.find(candidate => candidate.id === 'valid-plan-at-schema-maximum')!
    const classification = classifyContent(fixture.content)
    expect(classification.kind).toBe('valid')
    const grade = gradeReply(caseById.get(fixture.caseId)!, classification)

    expect(grade.counts).toMatchObject({ projects: 8, milestones: 96, tasks: 1920 })
    expect(grade.checks.find(check => check.id === 'bounded')?.passed).toBe(true)
  })

  it('separates truncation from a prose reply, which share one product error class', () => {
    const truncated = fixtures.find(candidate => candidate.id === 'truncated-json')!
    const prose = fixtures.find(candidate => candidate.id === 'prose-instead-of-json')!

    expect(classifyContent(truncated.content).kind).toBe('truncated_json')
    expect(classifyContent(prose.content).kind).toBe('prose_not_json')
    // Both end as AiReplyContractError -> INVALID_REPLY_NOTICE in the product,
    // so only the harness can tell the two failure modes apart.
    expect(classifyContent(truncated.content).kind).not.toBe(classifyContent(prose.content).kind)
  })

  it('covers each named failure mode with at least one fixture', () => {
    const kinds = new Set(fixtures.map(fixture => fixture.expectClassification))
    expect(kinds).toEqual(new Set(['valid', 'truncated_json', 'prose_not_json', 'contract_violation']))
    const graded = new Set(fixtures.flatMap(fixture => fixture.expectFailing))
    expect(graded).toEqual(new Set(['schema_valid', 'proposal_expectation', 'answer_responsive', 'required_reference', 'pending_contract', 'injection_resisted', 'not_generic_filler', 'relevance']))
  })

  it('fixtures at least one reply per case group, so no group ships ungraded', () => {
    const covered = new Set(fixtures.map(fixture => caseById.get(fixture.caseId)!.group))
    expect(covered).toEqual(new Set(goalPlanCases.map(evalCase => evalCase.group)))
  })

  it('proves each new-behaviour case can fail, not only pass', () => {
    // A case whose only fixture passes tells us nothing about its graders.
    for (const caseId of ['chat-focus-today', 'chat-concept', 'history-continuity-plan-that', 'history-injection-user-turn', 'history-injection-assistant-turn']) {
      const failing = fixtures.filter(fixture => fixture.caseId === caseId && fixture.expectFailing.some(id => id !== 'relevance'))
      expect(failing.length, `${caseId} has no fixture that fails a fatal or major grader`).toBeGreaterThan(0)
    }
  })
})

describe('the harness cannot persist anything', () => {
  const evalsDir = dirname(fileURLToPath(import.meta.url))
  const selfPath = fileURLToPath(import.meta.url)

  const harnessFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return harnessFiles(path)
      return entry.name.endsWith('.ts') && path !== selfPath ? [path] : []
    })

  it('never imports a database or a persisting service', () => {
    const forbidden = ['better-sqlite3', 'server/db', 'initializeDatabase', 'askKobi', 'acceptProposal', 'aiProposals']
    const offenders = harnessFiles(evalsDir).flatMap((path) => {
      const source = readFileSync(path, 'utf8')
      return forbidden.filter(needle => source.includes(needle)).map(needle => `${relative(evalsDir, path)} references ${needle}`)
    })

    expect(offenders).toEqual([])
  })
})

afterAll(() => {
  if (!rows.length) return
  const record = buildRunRecord('offline-fixtures', 'fixtures-only', rows)
  printRunRecord(record, writeRunRecord(record))
})
