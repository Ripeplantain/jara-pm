import { asc, eq } from 'drizzle-orm'
import type { KobiDb } from '~~/server/db'
import { users, workspaceMembers } from '~~/server/db/schema'
import type { WorkspaceMember } from '~~/shared/types/domain'

export const listWorkspaceMembers = (db: KobiDb, workspaceId: string): WorkspaceMember[] => {
  return db.select({
    userId: users.id,
    name: users.name,
    email: users.email,
    role: workspaceMembers.role,
    joinedAt: workspaceMembers.joinedAt,
  })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(asc(users.name), asc(users.email))
    .all()
}
