import { z } from 'zod'
import { dateSchema, idSchema, MAX_TITLE_LENGTH, titleSchema } from '#shared/schemas/common'
import { TASK_PRIORITIES } from '#shared/types/domain'
import { MAX_ESTIMATE } from '#shared/utils/estimates'

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

export const TRIAGE_BOUNDS = {
  labelIds: 6,
  reasonLength: 240,
} as const

export const RESCHEDULE_BOUNDS = {
  changes: 20,
  candidates: 30,
  horizonDays: 14,
  reasonLength: 200,
  noteLength: 500,
} as const

export const triageRequestSchema = z.object({ taskId: idSchema })
export const rescheduleRequestSchema = z.object({}).strict()
export const breakdownRequestSchema = z.object({ projectId: idSchema })

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

export const triageProposalSchema = z.object({
  kind: z.literal('triage'),
  taskId: idSchema,
  labelIds: z.array(idSchema).max(TRIAGE_BOUNDS.labelIds),
  priority: z.enum(TASK_PRIORITIES),
  projectId: idSchema.nullable(),
  estimate: z.number().int().min(1).max(MAX_ESTIMATE).nullable(),
  reason: z.string().trim().max(TRIAGE_BOUNDS.reasonLength),
})

export const rescheduleProposalSchema = z.object({
  kind: z.literal('reschedule'),
  note: z.string().trim().max(RESCHEDULE_BOUNDS.noteLength),
  changes: z.array(z.object({
    taskId: idSchema,
    dueDate: dateSchema,
    scheduledFor: dateSchema,
    selectedForToday: z.boolean(),
    // Rescheduling may leave status alone, park work, or abandon it. It may never
    // claim that work was started or completed on the user's behalf.
    statusCategory: z.enum(['backlog', 'canceled']).nullable(),
    reason: z.string().trim().max(RESCHEDULE_BOUNDS.reasonLength),
  })).min(1).max(RESCHEDULE_BOUNDS.changes),
})

// A breakdown adds milestones (and their tasks) to an existing project. Its milestone shape is
// goal_plan's own, derived rather than restated, so the two can never drift apart.
export const breakdownProposalSchema = z.object({
  kind: z.literal('breakdown'),
  projectId: idSchema,
  milestones: goalPlanProposalSchema.shape.projects.element.shape.milestones,
})

// The four task fields an accepted reschedule can change. Undo compares and restores exactly these.
const rescheduleTaskStateSchema = z.object({
  dueDate: dateSchema,
  scheduledFor: dateSchema,
  statusId: idSchema,
  selectedForToday: z.boolean(),
})

// What `ai_proposal_snapshots.snapshot_json` holds for one accepted reschedule.
export const rescheduleSnapshotSchema = z.array(z.object({
  taskId: idSchema,
  before: rescheduleTaskStateSchema,
  after: rescheduleTaskStateSchema,
})).min(1).max(RESCHEDULE_BOUNDS.changes)

export const proposalSchema = z.discriminatedUnion('kind', [
  goalPlanProposalSchema,
  triageProposalSchema,
  rescheduleProposalSchema,
  breakdownProposalSchema,
])

// Optional user-edited plan sent on accept. Reuses the proposal schema verbatim so
// the client and server share one set of bounds.
export const acceptProposalSchema = z.object({
  plan: goalPlanProposalSchema.optional(),
  proposal: proposalSchema.optional(),
}).refine(value => !(value.plan && value.proposal), {
  message: 'Send either plan or proposal, not both',
})

export const aiProviderResponseSchema = z.object({
  message: z.string().trim().min(1).max(10_000),
  proposal: goalPlanProposalSchema.nullable().default(null),
})

export const triageReplySchema = z.object({
  message: z.string().trim().min(1).max(10_000),
  proposal: triageProposalSchema.nullable().default(null),
})

export const rescheduleReplySchema = z.object({
  message: z.string().trim().min(1).max(10_000),
  proposal: rescheduleProposalSchema.nullable().default(null),
})

export const breakdownReplySchema = z.object({
  message: z.string().trim().min(1).max(10_000),
  proposal: breakdownProposalSchema.nullable().default(null),
})

// The milestone subtree is shared by the goal_plan and breakdown provider schemas, so a change
// to the shape or its bounds reaches both. aiReplyJsonSchema must stay deep-equal to what it
// was before this was extracted (tests/ai-breakdown.test.ts pins it).
const planMilestonesJsonSchema = {
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
} as const

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
                  milestones: planMilestonesJsonSchema,
                },
              },
            },
          },
        },
      ],
    },
  },
} as const

export const triageReplyJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['message', 'proposal'],
  properties: {
    message: { type: 'string', description: 'A concise explanation of the suggested organization. Never claim anything was saved.' },
    proposal: {
      description: 'null when the task is already well organized or there is not enough context to improve it',
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'taskId', 'labelIds', 'priority', 'projectId', 'estimate', 'reason'],
          properties: {
            kind: { type: 'string', enum: ['triage'] },
            taskId: { type: 'string', description: 'Copy the exact task id supplied in context.' },
            labelIds: { type: 'array', maxItems: TRIAGE_BOUNDS.labelIds, items: { type: 'string' }, description: `At most ${TRIAGE_BOUNDS.labelIds} exact label ids supplied in context.` },
            priority: { type: 'string', enum: [...TASK_PRIORITIES] },
            projectId: { type: ['string', 'null'], description: 'An exact candidate project id supplied in context, or null.' },
            estimate: { type: ['integer', 'null'], minimum: 1, maximum: MAX_ESTIMATE, description: 'One of the estimate values supplied in context, or null.' },
            reason: { type: 'string', maxLength: TRIAGE_BOUNDS.reasonLength },
          },
        },
      ],
    },
  },
} as const

export const rescheduleReplyJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['message', 'proposal'],
  properties: {
    message: { type: 'string', description: 'A concise explanation of the proposed replan. Never claim anything was saved.' },
    proposal: {
      description: 'null when there are no applicable overdue tasks',
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'note', 'changes'],
          properties: {
            kind: { type: 'string', enum: ['reschedule'] },
            note: { type: 'string', maxLength: RESCHEDULE_BOUNDS.noteLength },
            changes: {
              type: 'array',
              minItems: 1,
              maxItems: RESCHEDULE_BOUNDS.changes,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['taskId', 'dueDate', 'scheduledFor', 'selectedForToday', 'statusCategory', 'reason'],
                properties: {
                  taskId: { type: 'string', description: 'Copy an exact candidate task id supplied in context.' },
                  dueDate: { type: ['string', 'null'], description: 'A real YYYY-MM-DD date inside the supplied horizon, or null.' },
                  scheduledFor: { type: ['string', 'null'], description: 'A real YYYY-MM-DD date inside the supplied horizon, or null.' },
                  selectedForToday: { type: 'boolean' },
                  statusCategory: { type: ['string', 'null'], enum: ['backlog', 'canceled', null], description: 'Use null to keep status, backlog to park, or canceled to abandon.' },
                  reason: { type: 'string', maxLength: RESCHEDULE_BOUNDS.reasonLength },
                },
              },
            },
          },
        },
      ],
    },
  },
} as const

export const breakdownReplyJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['message', 'proposal'],
  properties: {
    message: { type: 'string', description: 'A concise explanation of the proposed breakdown. Never claim anything was saved.' },
    proposal: {
      description: 'null when the project is already well covered or there is not enough context to break it down',
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'projectId', 'milestones'],
          properties: {
            kind: { type: 'string', enum: ['breakdown'] },
            projectId: { type: 'string', description: 'Copy the exact project id supplied in context.' },
            milestones: planMilestonesJsonSchema,
          },
        },
      ],
    },
  },
} as const
