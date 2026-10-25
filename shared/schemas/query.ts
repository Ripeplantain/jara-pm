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

// A repeated query parameter (`?labelIds=a&labelIds=b`) reaches the handler as an array, while
// a single occurrence reaches it as a bare string, and the URL serialiser prefers the compact
// comma-separated spelling. All three are accepted and normalised to a deduped id list, so
// filters round-trip through the query string whichever form a caller used.
export const idListSchema = z.union([idSchema, z.array(idSchema), z.string()])
  .transform((value) => {
    const parts = Array.isArray(value) ? value : value.split(',')
    return [...new Set(parts.map(part => part.trim()).filter(Boolean))]
  })
  .pipe(z.array(idSchema))
  .optional()

export const collectionQuerySchema = z.object({
  includeArchived: queryFlagSchema,
  goalId: idSchema.optional(),
})
