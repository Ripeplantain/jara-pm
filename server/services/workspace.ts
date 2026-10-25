import { and, asc, eq } from 'drizzle-orm'
import { createError } from 'h3'
import type { KobiDatabase, KobiDb } from '~~/server/db'
import { users, workspaceMembers, workspaces } from '~~/server/db/schema'
import { nowIso } from '~~/server/utils/time'
import type { CreateWorkspaceInput, UpdateWorkspaceInput } from '~~/shared/schemas/workspace'
import type { WorkspaceListItem, WorkspaceMember, WorkspaceSummary } from '~~/shared/types/domain'
import { deriveWorkspaceKey } from '~~/shared/utils/task-key'

// `workspaces.key` is UNIQUE, so the taken set is read inside the caller's transaction.
export const allocateWorkspaceKey = (tx: KobiDb, name: string): string => {
  const taken = tx.select({ key: workspaces.key }).from(workspaces).all().map(row => row.key)
  return deriveWorkspaceKey(name, taken)
}

export const listWorkspaces = (db: KobiDb, userId: string): WorkspaceListItem[] => {
  const account = db.select({ activeWorkspaceId: users.activeWorkspaceId })
    .from(users)
    .where(eq(users.id, userId))
    .get()
  if (!account) throw createError({ status: 404, statusText: 'User not found' })

  return db.select({
    id: workspaces.id,
    name: workspaces.name,
    key: workspaces.key,
    estimateScale: workspaces.estimateScale,
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
  let key = ''

  db.transaction((tx) => {
    key = allocateWorkspaceKey(tx, input.name)
    tx.insert(workspaces).values({
      id,
      name: input.name,
      key,
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

  return { id, name: input.name, key, estimateScale: 'none', role: 'owner', isActive: true }
}

export const getWorkspace = (db: KobiDb, userId: string, workspaceId: string): WorkspaceSummary => {
  const workspace = db.select({
    id: workspaces.id,
    name: workspaces.name,
    key: workspaces.key,
    estimateScale: workspaces.estimateScale,
    role: workspaceMembers.role,
  })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .get()
  if (!workspace) throw createError({ status: 403, statusText: 'Workspace membership required' })
  return workspace
}

export const updateWorkspace = (
  db: KobiDb,
  userId: string,
  workspaceId: string,
  input: UpdateWorkspaceInput,
): WorkspaceSummary => {
  const current = getWorkspace(db, userId, workspaceId)
  const key = input.key ?? current.key
  // `workspaces.key` is UNIQUE across the install, so a clash is a 409 rather than a
  // constraint error surfacing as a 500.
  if (key !== current.key) {
    const clash = db.select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.key, key))
      .get()
    if (clash) throw createError({ status: 409, statusText: 'That workspace key is already taken' })
  }
  // Changing the scale deliberately leaves stored estimates untouched: the scale only decides
  // which values a picker offers, and a task keeps the points it was given.
  db.update(workspaces)
    .set({
      name: input.name ?? current.name,
      key,
      estimateScale: input.estimateScale ?? current.estimateScale,
      updatedAt: nowIso(),
    })
    .where(eq(workspaces.id, workspaceId))
    .run()
  return getWorkspace(db, userId, workspaceId)
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
      key: workspaces.key,
      estimateScale: workspaces.estimateScale,
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
