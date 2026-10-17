import { loginSchema } from '#shared/schemas/auth'
import type { UserRow } from '~~/server/types/database'
import { useDatabase } from '~~/server/utils/database'
import { nowIso } from '~~/server/utils/time'

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, loginSchema.parse)
  const db = useDatabase(event)
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(body.email) as UserRow | undefined

  if (!row || !(await verifyPassword(row.password_hash, body.password))) {
    throw createError({ status: 401, statusText: 'Invalid email or password' })
  }

  const user = { id: row.id, email: row.email, name: row.name }
  await setUserSession(event, { user, loggedInAt: nowIso() })
  return user
})
