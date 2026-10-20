import { eq } from 'drizzle-orm'
import type { KobiDatabase } from '../server/db'
import { users, workspaceMembers, workspaces } from '../server/db/schema'

export const createWorkspaceForUser = (db: KobiDatabase, userId: string) => {
  const workspaceId = `workspace-${userId}`
  const now = '2026-01-01T00:00:00.000Z'
  db.insert(workspaces).values({
    id: workspaceId,
    name: 'Test workspace',
    ownerId: userId,
    createdAt: now,
    updatedAt: now,
  }).run()
  db.insert(workspaceMembers).values({
    workspaceId,
    userId,
    role: 'owner',
    joinedAt: now,
  }).run()
  db.update(users)
    .set({ activeWorkspaceId: workspaceId })
    .where(eq(users.id, userId))
    .run()
  return workspaceId
}
