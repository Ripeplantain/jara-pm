import { describe, expect, it } from 'vitest'
import { acceptProposalSchema, goalPlanProposalSchema } from '../shared/schemas/ai'
import type { GoalPlanProposal } from '../shared/types/domain'
import { firstPlanIssue, toDraft, toPlan } from '../app/composables/useProposalDraft'

const plan: GoalPlanProposal = {
  kind: 'goal_plan',
  goal: { title: 'Ship Kobi', description: 'Release it.', targetDate: '2026-06-01' },
  projects: [{
    title: 'Prepare release',
    description: 'Details',
    milestones: [{
      title: 'Launch checklist',
      targetDate: null,
      tasks: [{ title: 'Deploy the app', dueDate: '2026-05-01', priority: 'high' }],
    }],
  }],
}

describe('proposal draft helpers', () => {
  it('round-trips a plan through toDraft and toPlan with ids stripped', () => {
    const draft = toDraft(plan)
    expect(draft.projects[0]?.id).toBeTruthy()
    const result = toPlan(draft)

    expect(result).toEqual(plan)
    expect(goalPlanProposalSchema.safeParse(result).success).toBe(true)
    expect(JSON.stringify(result)).not.toContain(draft.projects[0]!.id)
  })

  it('returns an empty string for a valid plan', () => {
    expect(firstPlanIssue(toDraft(plan))).toBe('')
  })

  it('reports whitespace-only titles', () => {
    const draft = toDraft(plan)
    draft.goal.title = '   '
    expect(firstPlanIssue(draft)).not.toBe('')
    expect(firstPlanIssue(draft)).toContain('goal')
  })

  it('reports an invalid date string such as an unparsed empty value', () => {
    const draft = toDraft(plan)
    draft.projects[0]!.milestones[0]!.targetDate = '' as never
    expect(firstPlanIssue(draft)).toContain('date')
  })
})

describe('acceptProposalSchema', () => {
  it('treats an empty body as no plan', () => {
    expect(acceptProposalSchema.parse({})).toEqual({})
  })

  it('accepts a valid plan and rejects an invalid one', () => {
    expect(acceptProposalSchema.parse({ plan }).plan).toEqual(plan)
    expect(acceptProposalSchema.safeParse({ plan: { ...plan, projects: [] } }).success).toBe(false)
  })
})
