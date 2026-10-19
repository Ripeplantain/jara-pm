import { z } from 'zod'

export const idSchema = z.string().uuid()
export const dateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [year = 0, month = 0, day = 0] = value.split('-').map(Number)
    const date = new Date(Date.UTC(year, month - 1, day))
    return date.getUTCFullYear() === year
      && date.getUTCMonth() === month - 1
      && date.getUTCDate() === day
  }, 'Invalid calendar date')
  .nullable()
export const MAX_TITLE_LENGTH = 200
export const titleSchema = z.string().trim().min(1).max(MAX_TITLE_LENGTH)
export const descriptionSchema = z.string().trim().max(10_000)
