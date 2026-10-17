import { z } from 'zod'
import { dateSchema, descriptionSchema, idSchema, titleSchema } from '#shared/schemas/common'
import { TASK_PRIORITIES, TASK_STATUSES } from '#shared/types/domain'

export const taskQuerySchema = z.object({
  scope: z.enum(['all', 'inbox', 'today', 'upcoming']).default('all'),
  projectId: idSchema.optional(),
  status: z.enum(TASK_STATUSES).optional(),
})

const taskFields = {
  title: titleSchema,
  description: descriptionSchema,
  status: z.enum(TASK_STATUSES),
  priority: z.enum(TASK_PRIORITIES),
  dueDate: dateSchema,
  scheduledFor: dateSchema,
  selectedForToday: z.boolean(),
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
  selectedForToday: taskFields.selectedForToday.default(false),
  projectId: taskFields.projectId.optional().default(null),
  milestoneId: taskFields.milestoneId.optional().default(null),
  parentId: taskFields.parentId.optional().default(null),
})

export const updateTaskSchema = z.object({
  title: taskFields.title.optional(),
  description: taskFields.description.optional(),
  status: taskFields.status.optional(),
  priority: taskFields.priority.optional(),
  dueDate: taskFields.dueDate.optional(),
  scheduledFor: taskFields.scheduledFor.optional(),
  selectedForToday: taskFields.selectedForToday.optional(),
  projectId: taskFields.projectId.optional(),
  milestoneId: taskFields.milestoneId.optional(),
  parentId: taskFields.parentId.optional(),
})

export type CreateTaskInput = z.infer<typeof createTaskSchema>
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>
export type TaskQuery = z.infer<typeof taskQuerySchema>
