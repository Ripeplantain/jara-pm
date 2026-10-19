import { describe, expect, it } from 'vitest'
import { askKobiSchema, goalPlanProposalSchema } from '../shared/schemas/ai'
import { createTaskSchema, updateTaskSchema } from '../shared/schemas/task'

describe('task input', () => {
  it('allows a title-only inbox task', () => {
    const task = createTaskSchema.parse({ title: 'Book the appointment' })
    expect(task.projectId).toBeNull()
    expect(task.status).toBe('todo')
    expect(task.recurrence).toBe('none')
  })

  it('does not apply create defaults to a partial update', () => {
    expect(updateTaskSchema.parse({ status: 'done' })).toEqual({ status: 'done' })
  })

  it('requires a due date for recurring tasks', () => {
    expect(() => createTaskSchema.parse({ title: 'Exercise', recurrence: 'daily' })).toThrow()
    expect(createTaskSchema.parse({ title: 'Exercise', dueDate: '2099-01-01', recurrence: 'daily' }).recurrence)
      .toBe('daily')
  })

  it('rejects unsupported recurrence values at the schema boundary', () => {
    expect(() => createTaskSchema.parse({ title: 'Exercise', recurrence: 'monthly', dueDate: '2099-01-01' })).toThrow()
    expect(() => updateTaskSchema.parse({ recurrence: 'monthly' })).toThrow()
  })

  it('requires recurring tasks to start open', () => {
    expect(() => createTaskSchema.parse({
      title: 'Exercise', dueDate: '2099-01-01', recurrence: 'daily', status: 'done',
    })).toThrow()
  })

  it('rejects invalid calendar dates', () => {
    expect(() => createTaskSchema.parse({ title: 'Exercise', dueDate: '2099-02-29' })).toThrow()
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
  it('accepts a 16000-character message', () => {
    expect(() => askKobiSchema.parse({ message: 'x'.repeat(16_000) })).not.toThrow()
  })

  it('rejects a 16001-character message', () => {
    expect(() => askKobiSchema.parse({ message: 'x'.repeat(16_001) })).toThrow()
  })
})
