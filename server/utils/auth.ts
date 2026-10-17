import type { H3Event } from 'h3'
import type { UserRow } from '~~/server/types/database'
import { useDatabase } from '~~/server/utils/database'

export const requireUser = async (event: H3Event) => {
  const session = await requireUserSession(event)
  const row = useDatabase(event).prepare('SELECT * FROM users WHERE id = ?')
    .get(session.user.id) as UserRow | undefined
  if (!row) {
    await clearUserSession(event)
    throw createError({ status: 401, statusText: 'Session expired' })
  }
  return { id: row.id, email: row.email, name: row.name }
}
