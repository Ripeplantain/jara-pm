import { z } from 'zod'
import { dateSchema, descriptionSchema, idSchema, titleSchema } from '#shared/schemas/common'
import { PROJECT_STATUSES } from '#shared/types/domain'

export const createProjectSchema = z.object({
  title: titleSchema,
  description: descriptionSchema.default(''),
  goalId: idSchema.nullable().optional().default(null),
  targetDate: dateSchema.optional().default(null),
})

export const updateProjectSchema = z.object({
  title: titleSchema.optional(),
  description: descriptionSchema.optional(),
  goalId: idSchema.nullable().optional(),
  targetDate: dateSchema.optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
})

export const createMilestoneSchema = z.object({
  title: titleSchema,
  description: descriptionSchema.default(''),
  targetDate: dateSchema.optional().default(null),
})

export const updateMilestoneSchema = z.object({
  title: titleSchema.optional(),
  description: descriptionSchema.optional(),
  targetDate: dateSchema.optional(),
  status: z.enum(['active', 'completed']).optional(),
})

export type CreateProjectInput = z.infer<typeof createProjectSchema>
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>
export type CreateMilestoneInput = z.infer<typeof createMilestoneSchema>
export type UpdateMilestoneInput = z.infer<typeof updateMilestoneSchema>
