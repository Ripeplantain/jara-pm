import { describe, expect, it } from 'vitest'
import { askKobiSchema, goalPlanProposalSchema } from '../shared/schemas/ai'
import { createTaskSchema, updateTaskSchema } from '../shared/schemas/task'

describe('task input', () => {
  it('allows a title-only inbox task', () => {
    const task = createTaskSchema.parse({ title: 'Book the appointment' })
    expect(task.projectId).toBeNull()
    expect(task.status).toBe('todo')
  })

  it('does not apply create defaults to a partial update', () => {
    expect(updateTaskSchema.parse({ status: 'done' })).toEqual({ status: 'done' })
  })
})

describe('AI proposal validation', () => {
  it('rejects a plan with no actionable tasks', () => {
    expect(() => goalPlanProposalSchema.parse({
      kind: 'goal_plan',
      goal: { title: 'Learn AI', description: '', targetDate: null },
      projects: [{
        title: 'Foundations', description: '',
        milestones: [{ title: 'Start', targetDate: null, tasks: [] }],
      }],
    })).toThrow()
  })

  it('accepts a bounded, structured plan', () => {
    const result = goalPlanProposalSchema.parse({
      kind: 'goal_plan',
      goal: { title: 'Learn AI', description: 'Build practical skill', targetDate: null },
      projects: [{
        title: 'Foundations', description: '',
        milestones: [{
          title: 'Start', targetDate: null,
          tasks: [{ title: 'Complete lesson one', dueDate: null, priority: 'high' }],
        }],
      }],
    })
    expect(result.projects[0]?.milestones[0]?.tasks).toHaveLength(1)
  })
})

describe('Ask Kobi message validation', () => {
  it('accepts a 4000-character message', () => {
    expect(() => askKobiSchema.parse({ message: 'x'.repeat(4000) })).not.toThrow()
  })

  it('rejects a 4001-character message', () => {
    expect(() => askKobiSchema.parse({ message: 'x'.repeat(4001) })).toThrow()
  })
})
