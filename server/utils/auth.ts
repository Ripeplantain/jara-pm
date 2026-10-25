import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { users, workspaceMembers, workspaces } from '~~/server/db/schema'
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

export const requireWorkspaceMember = async (event: H3Event, workspaceId: string) => {
  const user = await requireUser(event)
  const membership = useDatabase(event).select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.userId, user.id),
    ))
    .get()
  if (!membership) {
    throw createError({ status: 403, statusText: 'You are not a member of this workspace' })
  }
  return { user, workspaceId, role: membership.role }
}

export const requireWorkspaceOwner = async (event: H3Event, workspaceId: string) => {
  const member = await requireWorkspaceMember(event, workspaceId)
  if (member.role !== 'owner') {
    throw createError({ status: 403, statusText: 'Workspace owner access required' })
  }
  return member
}

export const requireMember = async (event: H3Event) => {
  const user = await requireUser(event)
  const db = useDatabase(event)
  const account = db.select({ activeWorkspaceId: users.activeWorkspaceId })
    .from(users)
    .where(eq(users.id, user.id))
    .get()
  if (!account?.activeWorkspaceId) {
    throw createError({ status: 403, statusText: 'No active workspace' })
  }

  const membership = db.select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(
      eq(workspaceMembers.workspaceId, account.activeWorkspaceId),
      eq(workspaceMembers.userId, user.id),
    ))
    .get()
  if (!membership) {
    throw createError({ status: 403, statusText: 'You are not a member of this workspace' })
  }
  return { user, workspaceId: account.activeWorkspaceId, role: membership.role }
}

export const requireOwner = async (event: H3Event) => {
  const member = await requireMember(event)
  if (member.role !== 'owner') {
    throw createError({ status: 403, statusText: 'Workspace owner access required' })
  }
  return member
}

export const getWorkspaceDetails = (event: H3Event, workspaceId: string, userId: string) => {
  return useDatabase(event).select({
    id: workspaces.id,
    name: workspaces.name,
    key: workspaces.key,
    estimateScale: workspaces.estimateScale,
    role: workspaceMembers.role,
  })
    .from(workspaces)
    .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(and(eq(workspaceMembers.userId, userId), eq(workspaces.id, workspaceId)))
    .get()
}
