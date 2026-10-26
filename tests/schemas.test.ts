import { describe, expect, it } from 'vitest'
import { askKobiSchema, goalPlanProposalSchema } from '../shared/schemas/ai'
import { createLabelSchema, labelQuerySchema, updateLabelSchema } from '../shared/schemas/label'
import { idListSchema } from '../shared/schemas/query'
import { createTaskSchema, taskQuerySchema, updateTaskSchema } from '../shared/schemas/task'
import {
  createWorkspaceSchema,
  updateWorkspaceSchema,
  workspaceKeySchema,
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

  it('accepts legacy migrated workspace ids without relaxing related identifiers', () => {
    const workspaceId = 'cc11f28cbb821f695b002b474836ff1f'
    const id = '68e9ef85-4804-47b9-8656-a296a05f3ff9'

    expect(workspaceParamsSchema.parse({ workspaceId })).toEqual({ workspaceId })
    expect(workspaceInviteParamsSchema.parse({ workspaceId, id })).toEqual({ workspaceId, id })
    expect(workspaceMemberParamsSchema.parse({ workspaceId, userId: id })).toEqual({ workspaceId, userId: id })

    expect(() => workspaceParamsSchema.parse({ workspaceId: 'cc11f28cbb821f695b002b474836ff1' })).toThrow()
    expect(() => workspaceParamsSchema.parse({ workspaceId: 'gc11f28cbb821f695b002b474836ff1f' })).toThrow()
    expect(() => workspaceParamsSchema.parse({ workspaceId: workspaceId.toUpperCase() })).toThrow()
    expect(() => workspaceInviteParamsSchema.parse({ workspaceId, id: workspaceId })).toThrow()
    expect(() => workspaceMemberParamsSchema.parse({ workspaceId, userId: workspaceId })).toThrow()
  })
})

describe('task input', () => {
  it('allows a title-only inbox task', () => {
    const task = createTaskSchema.parse({ title: 'Book the appointment' })
    expect(task.projectId).toBeNull()
    // Absent means the workspace default, which only the service can resolve.
    expect(task.statusId).toBeUndefined()
    expect(task.recurrence).toBe('none')
  })

  it('does not apply create defaults to a partial update', () => {
    const statusId = '55555555-5555-4555-8555-555555555555'
    expect(updateTaskSchema.parse({ statusId })).toEqual({ statusId })
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

  // Whether a status is open needs its category, which the schema cannot see: the "recurring
  // tasks must start open" rule lives in the service (tests/tasks.test.ts).
  it('requires a status id to be a uuid, and no longer accepts the legacy status field', () => {
    expect(() => createTaskSchema.parse({ title: 'Exercise', statusId: 'done' })).toThrow()
    expect(() => updateTaskSchema.parse({ statusId: 'in_progress' })).toThrow()
    expect(createTaskSchema.parse({ title: 'Exercise', status: 'done' })).not.toHaveProperty('status')
    expect(updateTaskSchema.parse({ status: 'done' })).toEqual({})
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


describe('workspace key input', () => {
  it('upper-cases a hand-typed key', () => {
    expect(workspaceKeySchema.parse(' acme ')).toBe('ACME')
    expect(updateWorkspaceSchema.parse({ key: 'k' })).toEqual({ key: 'K' })
  })

  it('accepts digits after the first character', () => {
    expect(workspaceKeySchema.parse('A2')).toBe('A2')
    expect(workspaceKeySchema.parse('TEAM1')).toBe('TEAM1')
  })

  it('rejects keys the database CHECK would reject', () => {
    for (const value of ['', '1A', 'TOOLONG', 'A-B', 'A B', 'Ä']) {
      expect(() => workspaceKeySchema.parse(value), value).toThrow()
    }
  })

  it('leaves out every field the caller did not send', () => {
    expect(updateWorkspaceSchema.parse({})).toEqual({})
  })
})

describe('label input', () => {
  const groupId = '8a5c64c8-9fb8-43d8-bf43-7583392d3479'

  it('defaults a new label to an ungrouped slate label', () => {
    expect(createLabelSchema.parse({ name: ' bug ' }))
      .toEqual({ name: 'bug', color: 'slate', description: '', groupId: null })
  })

  it('accepts a group and a colour from the fixed palette', () => {
    expect(createLabelSchema.parse({ name: 'bug', color: 'red', groupId }))
      .toEqual({ name: 'bug', color: 'red', description: '', groupId })
  })

  it('rejects an empty name, an oversized name, and a colour outside the palette', () => {
    expect(() => createLabelSchema.parse({ name: '   ' })).toThrow()
    expect(() => createLabelSchema.parse({ name: 'x'.repeat(61) })).toThrow()
    expect(() => createLabelSchema.parse({ name: 'bug', color: 'chartreuse' })).toThrow()
  })

  it('treats archiving as an explicit boolean, not an absence', () => {
    expect(updateLabelSchema.parse({})).toEqual({})
    expect(updateLabelSchema.parse({ archived: false })).toEqual({ archived: false })
    expect(updateLabelSchema.parse({ archived: true })).toEqual({ archived: true })
  })

  it('reads the archived query flag the way useFetch serialises it', () => {
    expect(labelQuerySchema.parse({})).toEqual({ includeArchived: undefined })
    expect(labelQuerySchema.parse({ includeArchived: 'false' })).toEqual({ includeArchived: false })
    expect(labelQuerySchema.parse({ includeArchived: 'true' })).toEqual({ includeArchived: true })
  })
})

describe('id list query input', () => {
  const first = '8a5c64c8-9fb8-43d8-bf43-7583392d3479'
  const second = '68e9ef85-4804-47b9-8656-a296a05f3ff9'

  it('accepts a single id, a repeated parameter, and a comma-separated list alike', () => {
    expect(idListSchema.parse(first)).toEqual([first])
    expect(idListSchema.parse([first, second])).toEqual([first, second])
    expect(idListSchema.parse(`${first},${second}`)).toEqual([first, second])
    expect(idListSchema.parse(`${first}, ${second}`)).toEqual([first, second])
  })

  it('dedupes so a filter cannot be doubled by the URL', () => {
    expect(idListSchema.parse(`${first},${first}`)).toEqual([first])
  })

  it('is absent rather than empty when the parameter is omitted', () => {
    expect(taskQuerySchema.parse({ scope: 'all' }).labelIds).toBeUndefined()
  })

  it('rejects a list containing anything that is not an id', () => {
    expect(() => idListSchema.parse(`${first},not-an-id`)).toThrow()
  })

  it('reads an empty parameter as no filter rather than a bad request', () => {
    // `?labelIds=` is what a URL serialiser emits when the filter is cleared, and an empty
    // list applies no label condition at all.
    expect(idListSchema.parse('')).toEqual([])
    expect(idListSchema.parse(',')).toEqual([])
  })
})

describe('task estimate and label input', () => {
  const labelId = '8a5c64c8-9fb8-43d8-bf43-7583392d3479'

  it('defaults a new task to no estimate and no labels', () => {
    const parsed = createTaskSchema.parse({ title: 'Plain' })
    expect(parsed.estimate).toBeNull()
    expect(parsed.labelIds).toEqual([])
  })

  it('distinguishes clearing an estimate from leaving it alone', () => {
    expect(updateTaskSchema.parse({ estimate: null })).toEqual({ estimate: null })
    expect(updateTaskSchema.parse({})).toEqual({})
  })

  it('caps how many labels one write may set', () => {
    expect(() => createTaskSchema.parse({ title: 'Many', labelIds: Array.from({ length: 51 }, () => labelId) }))
      .toThrow()
  })
})
