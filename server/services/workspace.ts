import { and, asc, eq } from 'drizzle-orm'
import { createError } from 'h3'
import type { KobiDatabase, KobiDb } from '~~/server/db'
import { users, workspaceMembers, workspaces } from '~~/server/db/schema'
import { nowIso } from '~~/server/utils/time'
import type { CreateWorkspaceInput } from '~~/shared/schemas/workspace'
import type { WorkspaceListItem, WorkspaceMember } from '~~/shared/types/domain'

export const listWorkspaces = (db: KobiDb, userId: string): WorkspaceListItem[] => {
  const account = db.select({ activeWorkspaceId: users.activeWorkspaceId })
    .from(users)
    .where(eq(users.id, userId))
    .get()
  if (!account) throw createError({ status: 404, statusText: 'User not found' })

  return db.select({
    id: workspaces.id,
    name: workspaces.name,
    role: workspaceMembers.role,
  })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(asc(workspaces.createdAt), asc(workspaces.name))
    .all()
    .map(workspace => ({
      ...workspace,
      isActive: workspace.id === account.activeWorkspaceId,
    }))
}

export const createWorkspace = (
  db: KobiDatabase,
  userId: string,
  input: CreateWorkspaceInput,
): WorkspaceListItem => {
  const id = crypto.randomUUID()
  const now = nowIso()

  db.transaction((tx) => {
    tx.insert(workspaces).values({
      id,
      name: input.name,
      ownerId: userId,
      createdAt: now,
      updatedAt: now,
    }).run()
    tx.insert(workspaceMembers).values({
      workspaceId: id,
      userId,
      role: 'owner',
      joinedAt: now,
    }).run()
    tx.update(users)
      .set({ activeWorkspaceId: id, updatedAt: now })
      .where(eq(users.id, userId))
      .run()
  })

  return { id, name: input.name, role: 'owner', isActive: true }
}

export const activateWorkspace = (
  db: KobiDatabase,
  userId: string,
  workspaceId: string,
): WorkspaceListItem => {
  return db.transaction((tx) => {
    const workspace = tx.select({
      id: workspaces.id,
      name: workspaces.name,
      role: workspaceMembers.role,
    })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
      ))
      .get()
    if (!workspace) {
      throw createError({ status: 403, statusText: 'Workspace membership required' })
    }

    tx.update(users)
      .set({ activeWorkspaceId: workspaceId, updatedAt: nowIso() })
      .where(eq(users.id, userId))
      .run()
    return { ...workspace, isActive: true }
  })
}

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
