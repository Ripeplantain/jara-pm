import { describe, expect, it } from 'vitest'
import {
  buildProviderRequest,
  CHAT_MAX_TOKENS,
  GOAL_PLAN_MAX_TOKENS,
  localPlan,
  PROMPT_VERSION,
  validateProviderReply,
} from '../server/services/ai'
import { goalPlanProposalSchema } from '../shared/schemas/ai'
import { MAX_TITLE_LENGTH } from '../shared/schemas/common'

const config = {
  apiKey: 'test-key',
  baseUrl: 'https://openrouter.ai/api/v1',
  chatModel: 'openai/gpt-4.1-mini',
  planModel: 'openai/gpt-4.1',
}

const context = {
  taskCounts: { open: 2, overdue: 0, done: 1 },
  projects: [],
  goals: [],
  today: '2026-10-17',
}

const validPlan = {
  message: 'I drafted a plan.',
  proposal: {
    kind: 'goal_plan' as const,
    goal: { title: 'Learn basketball', description: 'Build the fundamentals.', targetDate: null },
    projects: [{
      title: 'Build the foundation',
      description: 'Start with the basics.',
      milestones: [{
        title: 'First week',
        targetDate: null,
        tasks: [{ title: 'Practice ball handling', dueDate: null, priority: 'high' as const }],
      }],
    }],
  },
}

describe('Ask Kobi provider request', () => {
  it('uses the chat model for normal questions', () => {
    const request = buildProviderRequest(config, 'What should I focus on?', 'chat', context)

    expect(request.model).toBe(config.chatModel)
    expect(request.response_format.json_schema.strict).toBe(true)
    expect(request.messages[0]?.content).toContain(PROMPT_VERSION)
    expect(request.max_tokens).toBe(CHAT_MAX_TOKENS)
  })

  it('uses the stronger planning model for goal plans', () => {
    const request = buildProviderRequest(config, 'Help me plan a goal', 'goal_plan', context)

    expect(request.model).toBe(config.planModel)
    expect(request.response_format.json_schema.name).toBe('kobi_ai_reply')
    expect(request.response_format.json_schema.schema).toMatchObject({
      type: 'object',
      required: ['message', 'proposal'],
    })
    expect(request.max_tokens).toBe(GOAL_PLAN_MAX_TOKENS)
  })

  // An unset max_tokens makes OpenRouter reserve the model's full completion
  // window and reject the call with 402 on a budget-limited key.
  it('always bounds the completion length', () => {
    for (const mode of ['chat', 'goal_plan'] as const) {
      const request = buildProviderRequest(config, 'Plan something', mode, context)
      expect(request.max_tokens).toBeGreaterThan(0)
    }
  })

  it('keeps provider replies aligned with the requested mode', () => {
    expect(validateProviderReply({ message: 'Done.', proposal: null }, 'chat').proposal).toBeNull()
    expect(validateProviderReply(validPlan, 'goal_plan').proposal?.kind).toBe('goal_plan')
    expect(() => validateProviderReply(validPlan, 'chat')).toThrow('cannot include a proposal')
    expect(() => validateProviderReply({ message: 'I need more detail.', proposal: null }, 'goal_plan'))
      .toThrow('must include a proposal')
  })
})

describe('Ask Kobi local planner', () => {
  it('keeps a long message within the stored title bound', () => {
    const message = `I want to ${'build a very ambitious thing '.repeat(20)}`

    const title = localPlan(message).goal.title

    expect(message.length).toBeGreaterThan(MAX_TITLE_LENGTH)
    expect(title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH)
    expect(() => goalPlanProposalSchema.parse(localPlan(message))).not.toThrow()
  })

  it('leaves a short message intact', () => {
    expect(localPlan('I want to learn basketball').goal.title).toBe('Learn basketball')
  })
})
