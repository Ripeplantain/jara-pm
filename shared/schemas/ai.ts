import { z } from 'zod'
import { dateSchema, titleSchema } from '#shared/schemas/common'
import { TASK_PRIORITIES } from '#shared/types/domain'

export const MAX_AI_MESSAGE_LENGTH = 16_000

export const askKobiSchema = z.object({
  message: z.string().trim().min(1).max(MAX_AI_MESSAGE_LENGTH),
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

// OpenRouter uses this schema to constrain the provider response before Zod
// applies Kobi's business-level bounds and string validation.
export const aiReplyJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['message', 'proposal'],
  properties: {
    message: { type: 'string', description: 'The reply shown to the user. When proposal is null, answer the question asked, or ask one short question if the message names nothing to answer or plan.' },
    proposal: {
      description: 'null when the message names no plannable outcome; `message` then answers the question asked or asks one short question',
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'goal', 'projects'],
          properties: {
            kind: { type: 'string', enum: ['goal_plan'] },
            goal: {
              type: 'object',
              additionalProperties: false,
              required: ['title', 'description', 'targetDate'],
              properties: {
                title: { type: 'string' },
                description: { type: 'string' },
                targetDate: { type: ['string', 'null'] },
              },
            },
            projects: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['title', 'description', 'milestones'],
                properties: {
                  title: { type: 'string' },
                  description: { type: 'string' },
                  milestones: {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['title', 'targetDate', 'tasks'],
                      properties: {
                        title: { type: 'string' },
                        targetDate: { type: ['string', 'null'] },
                        tasks: {
                          type: 'array',
                          items: {
                            type: 'object',
                            additionalProperties: false,
                            required: ['title', 'dueDate', 'priority'],
                            properties: {
                              title: { type: 'string' },
                              dueDate: { type: ['string', 'null'] },
                              priority: { type: 'string', enum: ['none', 'low', 'medium', 'high'] },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      ],
    },
  },
} as const
