import { registerSchema } from '#shared/schemas/auth'
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
    db.prepare(`
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, body.email, body.name, passwordHash, now, now)
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('UNIQUE')) {
      throw createError({ status: 409, statusText: 'Email already registered' })
    }
    throw error
  }

  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow
  const user = { id: row.id, email: row.email, name: row.name }
  await setUserSession(event, { user, loggedInAt: now })
  setResponseStatus(event, 201)
  return user
})
