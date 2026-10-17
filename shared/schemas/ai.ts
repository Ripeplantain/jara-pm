import { z } from 'zod'
import { dateSchema, titleSchema } from '#shared/schemas/common'
import { TASK_PRIORITIES } from '#shared/types/domain'

export const askKobiSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  mode: z.enum(['chat', 'goal_plan']).default('chat'),
})

export const goalPlanProposalSchema = z.object({
  kind: z.literal('goal_plan'),
  goal: z.object({
    title: titleSchema,
    description: z.string().trim().max(5000),
    targetDate: dateSchema,
  }),
  projects: z.array(z.object({
    title: titleSchema,
    description: z.string().trim().max(5000),
    milestones: z.array(z.object({
      title: titleSchema,
      targetDate: dateSchema,
      tasks: z.array(z.object({
        title: titleSchema,
        dueDate: dateSchema,
        priority: z.enum(TASK_PRIORITIES),
      })).min(1).max(20),
    })).min(1).max(12),
  })).min(1).max(8),
})

export const aiProviderResponseSchema = z.object({
  message: z.string().trim().min(1).max(10_000),
  proposal: goalPlanProposalSchema.nullable().default(null),
})
