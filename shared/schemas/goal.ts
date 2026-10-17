import { z } from 'zod'
import { dateSchema, descriptionSchema, titleSchema } from '#shared/schemas/common'
import { GOAL_STATUSES } from '#shared/types/domain'

export const createGoalSchema = z.object({
  title: titleSchema,
  description: descriptionSchema.default(''),
  targetDate: dateSchema.optional().default(null),
})

export const updateGoalSchema = z.object({
  title: titleSchema.optional(),
  description: descriptionSchema.optional(),
  targetDate: dateSchema.optional(),
  status: z.enum(GOAL_STATUSES).optional(),
})

export type CreateGoalInput = z.infer<typeof createGoalSchema>
export type UpdateGoalInput = z.infer<typeof updateGoalSchema>
