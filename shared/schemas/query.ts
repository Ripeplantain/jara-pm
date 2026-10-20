import { z } from 'zod'
import { idSchema } from '#shared/schemas/common'

export const idParamsSchema = z.object({ id: idSchema })

// A query flag arrives as a string, and `z.coerce.boolean()` would read "false" as true
// (Boolean("false") === true) - which matters because useFetch serializes a false query value
// as the string "false". Each accepted spelling is therefore mapped explicitly. Absent means
// off, so a caller can simply omit the parameter.
export const queryFlagSchema = z.union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform(value => value === true || value === 'true' || value === '1')
  .optional()

export const collectionQuerySchema = z.object({
  includeArchived: queryFlagSchema,
  goalId: idSchema.optional(),
})
