import { z } from 'zod'
import { idSchema } from '#shared/schemas/common'
import { STATUS_CATEGORIES } from '#shared/types/domain'

export const MAX_STATUS_NAME_LENGTH = 60

// Names are unique per workspace, stored trimmed. The database UNIQUE index is the backstop.
export const statusNameSchema = z.string().trim().min(1).max(MAX_STATUS_NAME_LENGTH)

export const createStatusSchema = z.object({
  name: statusNameSchema,
  category: z.enum(STATUS_CATEGORIES),
})

// A status's category is immutable after creation: flipping Done from `completed` to `started`
// would silently rewrite completion semantics for every task holding it. Only the name changes,
// plus the default flag, which is moved rather than cleared.
export const updateStatusSchema = z.object({
  name: statusNameSchema.optional(),
  isDefault: z.literal(true).optional(),
})

export const reorderStatusesSchema = z.object({
  statusIds: z.array(idSchema).min(1).max(100),
})

export const deleteStatusQuerySchema = z.object({
  replacementStatusId: idSchema.optional(),
})

export type CreateStatusInput = z.infer<typeof createStatusSchema>
export type UpdateStatusInput = z.infer<typeof updateStatusSchema>
export type ReorderStatusesInput = z.infer<typeof reorderStatusesSchema>
export type DeleteStatusQuery = z.infer<typeof deleteStatusQuerySchema>
