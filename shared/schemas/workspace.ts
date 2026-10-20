import { z } from 'zod'

export const workspaceInviteSchema = z.object({
  email: z.email().transform(value => value.trim().toLowerCase()),
})

export type WorkspaceInviteInput = z.infer<typeof workspaceInviteSchema>
