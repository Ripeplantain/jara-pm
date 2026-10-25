import { z } from 'zod'
import { dateSchema, descriptionSchema, idSchema, titleSchema } from '#shared/schemas/common'
import { MAX_ESTIMATE } from '#shared/utils/estimates'
import { idListSchema, queryFlagSchema } from '#shared/schemas/query'
import { TASK_PRIORITIES, TASK_RECURRENCES, TASK_STATUSES } from '#shared/types/domain'

export const taskQuerySchema = z.object({
  scope: z.enum(['all', 'inbox', 'today', 'upcoming']).default('all'),
  projectId: idSchema.optional(),
  status: z.enum(TASK_STATUSES).optional(),
  assignee: z.enum(['me', 'everyone', 'unassigned']).optional(),
  // AND semantics across labels: a task must carry every id listed here. Grouped labels are
  // single-select, so listing two siblings of one group matches nothing.
  labelIds: idListSchema,
  // The scoped views hide completed work by default. This opts a single request back in,
  // so a list can reveal what it is hiding without needing a separate scope.
  includeCompleted: queryFlagSchema,
})

const taskFields = {
  title: titleSchema,
  description: descriptionSchema,
  status: z.enum(TASK_STATUSES),
  priority: z.enum(TASK_PRIORITIES),
  dueDate: dateSchema,
  scheduledFor: dateSchema,
  recurrence: z.enum(TASK_RECURRENCES),
  selectedForToday: z.boolean(),
  // Bounds mirror the `tasks_estimate_check` constraint. Values are not checked against the
  // workspace's estimate scale: changing the scale must not invalidate stored estimates.
  estimate: z.number().int().min(1).max(MAX_ESTIMATE).nullable(),
  labelIds: z.array(idSchema).max(50),
  assigneeId: idSchema.nullable(),
  projectId: idSchema.nullable(),
  milestoneId: idSchema.nullable(),
  parentId: idSchema.nullable(),
}

export const createTaskSchema = z.object({
  title: taskFields.title,
  description: taskFields.description.default(''),
  status: taskFields.status.default('todo'),
  priority: taskFields.priority.default('none'),
  dueDate: taskFields.dueDate.optional().default(null),
  scheduledFor: taskFields.scheduledFor.optional().default(null),
  recurrence: taskFields.recurrence.default('none'),
  selectedForToday: taskFields.selectedForToday.default(false),
  estimate: taskFields.estimate.optional().default(null),
  labelIds: taskFields.labelIds.optional().default([]),
  assigneeId: taskFields.assigneeId.optional(),
  projectId: taskFields.projectId.optional().default(null),
  milestoneId: taskFields.milestoneId.optional().default(null),
  parentId: taskFields.parentId.optional().default(null),
}).superRefine((value, ctx) => {
  if (value.recurrence !== 'none' && !value.dueDate) {
    ctx.addIssue({ code: 'custom', path: ['dueDate'], message: 'Recurring tasks need a due date' })
  }
  if (value.recurrence !== 'none' && value.status === 'done') {
    ctx.addIssue({ code: 'custom', path: ['status'], message: 'Recurring tasks must start open' })
  }
})

export const updateTaskSchema = z.object({
  title: taskFields.title.optional(),
  description: taskFields.description.optional(),
  status: taskFields.status.optional(),
  priority: taskFields.priority.optional(),
  dueDate: taskFields.dueDate.optional(),
  scheduledFor: taskFields.scheduledFor.optional(),
  recurrence: taskFields.recurrence.optional(),
  selectedForToday: taskFields.selectedForToday.optional(),
  estimate: taskFields.estimate.optional(),
  labelIds: taskFields.labelIds.optional(),
  assigneeId: taskFields.assigneeId.optional(),
  projectId: taskFields.projectId.optional(),
  milestoneId: taskFields.milestoneId.optional(),
  parentId: taskFields.parentId.optional(),
})

export type CreateTaskInput = z.infer<typeof createTaskSchema>
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>
export type TaskQuery = z.infer<typeof taskQuerySchema>
