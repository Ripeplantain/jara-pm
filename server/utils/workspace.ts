import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import type { KobiDb } from '~~/server/db'
import { users, workspaceMembers } from '~~/server/db/schema'

export const workspaceIdForUser = (db: KobiDb, userId: string, workspaceId?: string) => {
  const candidate = workspaceId ?? db.select({ workspaceId: users.activeWorkspaceId })
    .from(users)
    .where(eq(users.id, userId))
    .get()?.workspaceId
  if (!candidate) throw createError({ status: 403, statusText: 'No active workspace' })
  const membership = db.select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, candidate), eq(workspaceMembers.userId, userId)))
    .get()
  if (!membership) throw createError({ status: 403, statusText: 'Workspace membership required' })
  return membership.workspaceId
}
