import { z } from 'zod'
import { idSchema } from '#shared/schemas/common'
import { ESTIMATE_SCALES } from '#shared/types/domain'
import { MAX_WORKSPACE_KEY_LENGTH } from '#shared/utils/task-key'

export const workspaceNameSchema = z.string().trim().min(1).max(120)

// Mirrors `workspaces_key_check`: an uppercase letter, then up to four more uppercase letters
// or digits. Lowercase input is upper-cased rather than rejected, since the key is typed by
// hand in settings and the constraint would otherwise read as an opaque failure.
export const workspaceKeySchema = z.string()
  .trim()
  .toUpperCase()
  .pipe(z.string().regex(new RegExp(`^[A-Z][A-Z0-9]{0,${MAX_WORKSPACE_KEY_LENGTH - 1}}$`)))

export const createWorkspaceSchema = z.object({
  name: workspaceNameSchema,
})

export const updateWorkspaceSchema = z.object({
  name: workspaceNameSchema.optional(),
  key: workspaceKeySchema.optional(),
  estimateScale: z.enum(ESTIMATE_SCALES).optional(),
})

export const workspaceInviteSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
})

// Migration 0002 created personal workspace ids with lower(hex(randomblob(16))). Keep those
// persisted ids addressable while all newly generated workspace ids continue to use UUIDs.
export const workspaceIdSchema = z.union([
  idSchema,
  z.string().regex(/^[0-9a-f]{32}$/),
])

export const workspaceParamsSchema = z.object({ workspaceId: workspaceIdSchema })
export const workspaceInviteParamsSchema = workspaceParamsSchema.extend({ id: idSchema })
export const workspaceMemberParamsSchema = workspaceParamsSchema.extend({ userId: idSchema })

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>
export type WorkspaceInviteInput = z.infer<typeof workspaceInviteSchema>
