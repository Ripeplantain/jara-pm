import { eq } from 'drizzle-orm'
import type { KobiDatabase } from '~~/server/db'
import { users, workspaceMembers, workspaces } from '~~/server/db/schema'
import { nowIso } from '~~/server/utils/time'

export const createUserWithPersonalWorkspace = (
  db: KobiDatabase,
  input: { email: string, name: string, passwordHash: string },
) => {
  const id = crypto.randomUUID()
  const now = nowIso()
  const workspaceId = crypto.randomUUID()

  db.transaction((tx) => {
    tx.insert(users).values({
      id,
      email: input.email,
      name: input.name,
      passwordHash: input.passwordHash,
      createdAt: now,
      updatedAt: now,
    }).run()
    tx.insert(workspaces).values({
      id: workspaceId,
      name: `${input.name}'s workspace`,
      ownerId: id,
      createdAt: now,
      updatedAt: now,
    }).run()
    tx.insert(workspaceMembers).values({
      workspaceId,
      userId: id,
      role: 'owner',
      joinedAt: now,
    }).run()
    tx.update(users)
      .set({ activeWorkspaceId: workspaceId })
      .where(eq(users.id, id))
      .run()
  })

  return {
    user: { id, email: input.email, name: input.name },
    workspaceId,
  }
}
