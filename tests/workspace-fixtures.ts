import { and, asc, eq } from 'drizzle-orm'
import type { KobiDatabase } from '../server/db'
import { statuses, users, workspaceMembers, workspaces } from '../server/db/schema'
import { seedWorkspaceStatuses } from '../server/services/statuses'
import { deriveWorkspaceKey } from '../shared/utils/task-key'

export const createWorkspaceForUser = (db: KobiDatabase, userId: string) => {
  const workspaceId = `workspace-${userId}`
  const now = '2026-01-01T00:00:00.000Z'
  const taken = db.select({ key: workspaces.key }).from(workspaces).all().map(row => row.key)
  db.insert(workspaces).values({
    id: workspaceId,
    name: 'Test workspace',
    key: deriveWorkspaceKey('Test workspace', taken),
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
  seedWorkspaceStatuses(db, workspaceId)
  db.update(users)
    .set({ activeWorkspaceId: workspaceId })
    .where(eq(users.id, userId))
    .run()
  return workspaceId
}

/** The id of the status in `workspaceId` with the given category (lowest position first). */
export const statusIdFor = (
  db: KobiDatabase,
  workspaceId: string,
  category: 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled',
) => {
  const row = db.select({ id: statuses.id })
    .from(statuses)
    .where(and(eq(statuses.workspaceId, workspaceId), eq(statuses.category, category)))
    .orderBy(asc(statuses.position))
    .get()
  if (!row) throw new Error(`No ${category} status in ${workspaceId}`)
  return row.id
}
