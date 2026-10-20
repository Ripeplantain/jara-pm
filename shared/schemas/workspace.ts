import { z } from 'zod'
import { idSchema } from '#shared/schemas/common'

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(120),
})

export const workspaceInviteSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
})

export const workspaceParamsSchema = z.object({ workspaceId: idSchema })
export const workspaceInviteParamsSchema = workspaceParamsSchema.extend({ id: idSchema })
export const workspaceMemberParamsSchema = workspaceParamsSchema.extend({ userId: idSchema })

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>
export type WorkspaceInviteInput = z.infer<typeof workspaceInviteSchema>
