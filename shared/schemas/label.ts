import { z } from 'zod'
import { idSchema } from '#shared/schemas/common'
import { queryFlagSchema } from '#shared/schemas/query'
import { LABEL_COLORS } from '#shared/types/domain'

export const MAX_LABEL_NAME_LENGTH = 60
export const MAX_LABEL_DESCRIPTION_LENGTH = 200

// Names are case-insensitively unique per workspace, so they are stored trimmed and the
// service compares them lowercased. The database UNIQUE index is the backstop.
export const labelNameSchema = z.string().trim().min(1).max(MAX_LABEL_NAME_LENGTH)
export const labelDescriptionSchema = z.string().trim().max(MAX_LABEL_DESCRIPTION_LENGTH)

export const labelQuerySchema = z.object({
  // Archived labels stay attached to historical tasks, so they are hidden from pickers by
  // default and only a settings surface asks for them.
  includeArchived: queryFlagSchema,
})

export const createLabelSchema = z.object({
  name: labelNameSchema,
  color: z.enum(LABEL_COLORS).default('slate'),
  description: labelDescriptionSchema.default(''),
  groupId: idSchema.nullable().optional().default(null),
})

export const updateLabelSchema = z.object({
  name: labelNameSchema.optional(),
  color: z.enum(LABEL_COLORS).optional(),
  description: labelDescriptionSchema.optional(),
  groupId: idSchema.nullable().optional(),
  archived: z.boolean().optional(),
})

export const createLabelGroupSchema = z.object({
  name: labelNameSchema,
})

export const updateLabelGroupSchema = z.object({
  name: labelNameSchema.optional(),
  position: z.number().int().min(0).max(10_000).optional(),
})

export const taskLabelSchema = z.object({
  labelId: idSchema,
})

export const taskLabelParamsSchema = z.object({
  id: idSchema,
  labelId: idSchema,
})

export type LabelQuery = z.infer<typeof labelQuerySchema>
export type CreateLabelInput = z.infer<typeof createLabelSchema>
export type UpdateLabelInput = z.infer<typeof updateLabelSchema>
export type CreateLabelGroupInput = z.infer<typeof createLabelGroupSchema>
export type UpdateLabelGroupInput = z.infer<typeof updateLabelGroupSchema>
