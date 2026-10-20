import { z } from 'zod'
import { dateSchema, MAX_TITLE_LENGTH, titleSchema } from '#shared/schemas/common'
import { TASK_PRIORITIES } from '#shared/types/domain'

export const MAX_AI_MESSAGE_LENGTH = 16_000
// Plan descriptions are bounded below descriptionSchema's 10_000, so the editor shares
// this rather than hardcoding the number a second time.
export const MAX_PLAN_DESCRIPTION_LENGTH = 5_000

export const askKobiSchema = z.object({
  message: z.string().trim().min(1).max(MAX_AI_MESSAGE_LENGTH),
})

// The one source of truth for plan shape. These are an outer ceiling, not a
// target: a plan is also bounded by MAX_REPLY_TOKENS, and at the density models
// actually write (~250-460 completion tokens per project) a plan at the project
// ceiling can overrun that budget and truncate. The prompt therefore asks for a
// smaller shape than this, and server/services/ai.ts trims an overrun to these
// numbers rather than discarding a usable plan.
export const PLAN_BOUNDS = {
  projects: 8,
  milestonesPerProject: 12,
  tasksPerMilestone: 20,
} as const

export const goalPlanProposalSchema = z.object({
  kind: z.literal('goal_plan'),
  goal: z.object({
    title: titleSchema,
    description: z.string().trim().max(MAX_PLAN_DESCRIPTION_LENGTH),
    targetDate: dateSchema,
  }),
  projects: z.array(z.object({
    title: titleSchema,
    description: z.string().trim().max(MAX_PLAN_DESCRIPTION_LENGTH),
    milestones: z.array(z.object({
      title: titleSchema,
      targetDate: dateSchema,
      tasks: z.array(z.object({
        title: titleSchema,
        dueDate: dateSchema,
        priority: z.enum(TASK_PRIORITIES),
      })).min(1).max(PLAN_BOUNDS.tasksPerMilestone),
    })).min(1).max(PLAN_BOUNDS.milestonesPerProject),
  })).min(1).max(PLAN_BOUNDS.projects),
})

// Optional user-edited plan sent on accept. Reuses the proposal schema verbatim so
// the client and server share one set of bounds.
export const acceptProposalSchema = z.object({
  plan: goalPlanProposalSchema.optional(),
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
                title: { type: 'string', description: `A short title, under ${MAX_TITLE_LENGTH} characters.` },
                description: { type: 'string' },
                targetDate: { type: ['string', 'null'] },
              },
            },
            projects: {
              description: `At most ${PLAN_BOUNDS.projects} projects. Merge related areas into one project rather than adding another; anything beyond this is trimmed away.`,
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['title', 'description', 'milestones'],
                properties: {
                  title: { type: 'string', description: `A short title, under ${MAX_TITLE_LENGTH} characters.` },
                  description: { type: 'string' },
                  milestones: {
                    description: `At most ${PLAN_BOUNDS.milestonesPerProject} milestones in a project; anything beyond this is trimmed away.`,
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['title', 'targetDate', 'tasks'],
                      properties: {
                        title: { type: 'string', description: `A short title, under ${MAX_TITLE_LENGTH} characters.` },
                        targetDate: { type: ['string', 'null'] },
                        tasks: {
                          description: `At most ${PLAN_BOUNDS.tasksPerMilestone} tasks in a milestone; anything beyond this is trimmed away.`,
                          type: 'array',
                          items: {
                            type: 'object',
                            additionalProperties: false,
                            required: ['title', 'dueDate', 'priority'],
                            properties: {
                              title: { type: 'string', description: `A short title, under ${MAX_TITLE_LENGTH} characters.` },
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
