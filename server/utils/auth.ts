import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { users } from '~~/server/db/schema'
import type { UserRow } from '~~/server/types/database'
import { useDatabase } from '~~/server/utils/database'

export const requireUser = async (event: H3Event) => {
  const session = await requireUserSession(event)
  const row = useDatabase(event).select({
    id: users.id,
    email: users.email,
    name: users.name,
    password_hash: users.passwordHash,
    created_at: users.createdAt,
    updated_at: users.updatedAt,
  }).from(users).where(eq(users.id, session.user.id)).get() as UserRow | undefined
  if (!row) {
    await clearUserSession(event)
    throw createError({ status: 401, statusText: 'Session expired' })
  }
  return { id: row.id, email: row.email, name: row.name }
}
