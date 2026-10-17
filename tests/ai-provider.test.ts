import { describe, expect, it } from 'vitest'
import { buildProviderRequest, PROMPT_VERSION, validateProviderReply } from '../server/services/ai'

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
  })

  it('uses the stronger planning model for goal plans', () => {
    const request = buildProviderRequest(config, 'Help me plan a goal', 'goal_plan', context)

    expect(request.model).toBe(config.planModel)
    expect(request.response_format.json_schema.name).toBe('kobi_ai_reply')
    expect(request.response_format.json_schema.schema).toMatchObject({
      type: 'object',
      required: ['message', 'proposal'],
    })
  })

  it('keeps provider replies aligned with the requested mode', () => {
    expect(validateProviderReply({ message: 'Done.', proposal: null }, 'chat').proposal).toBeNull()
    expect(validateProviderReply(validPlan, 'goal_plan').proposal?.kind).toBe('goal_plan')
    expect(() => validateProviderReply(validPlan, 'chat')).toThrow('cannot include a proposal')
    expect(() => validateProviderReply({ message: 'I need more detail.', proposal: null }, 'goal_plan'))
      .toThrow('must include a proposal')
  })
})
