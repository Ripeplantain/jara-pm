import { z } from 'zod'
import { idSchema } from '#shared/schemas/common'

export const idParamsSchema = z.object({ id: idSchema })

export const collectionQuerySchema = z.object({
  includeArchived: z.coerce.boolean().default(false),
  goalId: idSchema.optional(),
})
