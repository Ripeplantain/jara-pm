import { z } from 'zod'

export const credentialsSchema = z.object({
  email: z.email().transform(value => value.trim().toLowerCase()),
  password: z.string().min(8).max(128),
})

export const loginSchema = credentialsSchema.extend({
  password: z.string().min(1).max(128),
})

export const registerSchema = credentialsSchema.extend({
  name: z.string().trim().min(1).max(120),
  inviteToken: z.string().trim().min(32).max(128).optional(),
})
