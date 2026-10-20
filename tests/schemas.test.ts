import { describe, expect, it } from 'vitest'
import { askKobiSchema, goalPlanProposalSchema } from '../shared/schemas/ai'
import { createTaskSchema, updateTaskSchema } from '../shared/schemas/task'
import {
  createWorkspaceSchema,
  workspaceInviteParamsSchema,
  workspaceInviteSchema,
  workspaceMemberParamsSchema,
  workspaceParamsSchema,
} from '../shared/schemas/workspace'

describe('workspace input', () => {
  it('trims a valid workspace name', () => {
    expect(createWorkspaceSchema.parse({ name: '  Product team  ' })).toEqual({ name: 'Product team' })
  })

  it('rejects empty or oversized workspace names', () => {
    expect(() => createWorkspaceSchema.parse({ name: '   ' })).toThrow()
    expect(() => createWorkspaceSchema.parse({ name: 'x'.repeat(121) })).toThrow()
  })

  it('normalizes workspace invite email addresses', () => {
    expect(workspaceInviteSchema.parse({ email: ' MEMBER@Example.Test ' }))
      .toEqual({ email: 'member@example.test' })
  })

  it('validates workspace-scoped route identifiers', () => {
    const workspaceId = '8a5c64c8-9fb8-43d8-bf43-7583392d3479'
    const id = '68e9ef85-4804-47b9-8656-a296a05f3ff9'
    expect(workspaceParamsSchema.parse({ workspaceId })).toEqual({ workspaceId })
    expect(workspaceInviteParamsSchema.parse({ workspaceId, id })).toEqual({ workspaceId, id })
    expect(workspaceMemberParamsSchema.parse({ workspaceId, userId: id })).toEqual({ workspaceId, userId: id })
    expect(() => workspaceParamsSchema.parse({ workspaceId: 'not-an-id' })).toThrow()
  })
})

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
