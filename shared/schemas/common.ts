import { z } from 'zod'

export const idSchema = z.string().uuid()
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()
export const titleSchema = z.string().trim().min(1).max(200)
export const descriptionSchema = z.string().trim().max(10_000)
