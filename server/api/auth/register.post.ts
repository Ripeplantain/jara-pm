import { eq } from 'drizzle-orm'
import { registerSchema } from '#shared/schemas/auth'
import { users } from '~~/server/db/schema'
import type { UserRow } from '~~/server/types/database'
import { useDatabase } from '~~/server/utils/database'
import { nowIso } from '~~/server/utils/time'

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, registerSchema.parse)
  const db = useDatabase(event)
  const id = crypto.randomUUID()
  const now = nowIso()
  const passwordHash = await hashPassword(body.password)

  try {
    db.insert(users).values({
      id,
      email: body.email,
      name: body.name,
      passwordHash,
      createdAt: now,
      updatedAt: now,
    }).run()
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('UNIQUE')) {
      throw createError({ status: 409, statusText: 'Email already registered' })
    }
    throw error
  }

  const row = db.select({
    id: users.id,
    email: users.email,
    name: users.name,
    password_hash: users.passwordHash,
    created_at: users.createdAt,
    updated_at: users.updatedAt,
  }).from(users).where(eq(users.id, id)).get() as UserRow
  const user = { id: row.id, email: row.email, name: row.name }
  await setUserSession(event, { user, loggedInAt: now })
  setResponseStatus(event, 201)
  return user
})
