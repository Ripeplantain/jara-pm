import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { KobiDatabase } from '../server/db'
import { users, workspaceMembers } from '../server/db/schema'
import { activateWorkspace, createWorkspace, listWorkspaces } from '../server/services/workspace'
import { initializeDatabase } from '../server/utils/database'
import { createWorkspaceForUser } from './workspace-fixtures'

describe('workspace service', () => {
  let sqlite: Database.Database
  let db: KobiDatabase

  beforeEach(() => {
    sqlite = new Database(':memory:')
    db = initializeDatabase(sqlite)
    const now = '2026-01-01T00:00:00.000Z'
    db.insert(users).values([
      { id: 'workspace-owner', email: 'owner@example.test', name: 'Owner', passwordHash: 'hash', createdAt: now, updatedAt: now },
      { id: 'workspace-outsider', email: 'outsider@example.test', name: 'Outsider', passwordHash: 'hash', createdAt: now, updatedAt: now },
    ]).run()
    createWorkspaceForUser(db, 'workspace-owner')
    createWorkspaceForUser(db, 'workspace-outsider')
  })

  afterEach(() => {
    sqlite.close()
  })

  it('lists memberships and marks only the active workspace', () => {
    const created = createWorkspace(db, 'workspace-owner', { name: 'Team workspace' })

    expect(created).toMatchObject({ name: 'Team workspace', role: 'owner', isActive: true })
    expect(listWorkspaces(db, 'workspace-owner')).toEqual([
      {
        id: 'workspace-workspace-owner',
        name: 'Test workspace',
        role: 'owner',
        isActive: false,
      },
      created,
    ])
  })

  it('allows a member to activate an explicitly targeted workspace', () => {
    const created = createWorkspace(db, 'workspace-owner', { name: 'Shared workspace' })
    db.insert(workspaceMembers).values({
      workspaceId: created.id,
      userId: 'workspace-outsider',
      role: 'member',
      joinedAt: '2026-01-02T00:00:00.000Z',
    }).run()

    expect(activateWorkspace(db, 'workspace-outsider', created.id)).toEqual({
      id: created.id,
      name: 'Shared workspace',
      role: 'member',
      isActive: true,
    })
    expect(db.select({ activeWorkspaceId: users.activeWorkspaceId })
      .from(users).where(eq(users.id, 'workspace-outsider')).get())
      .toEqual({ activeWorkspaceId: created.id })
  })

  it('does not change the active workspace when activation is unauthorized', () => {
    const original = listWorkspaces(db, 'workspace-owner').find(workspace => workspace.isActive)
    const outsiderWorkspace = listWorkspaces(db, 'workspace-outsider').find(workspace => workspace.isActive)
    if (!original || !outsiderWorkspace) throw new Error('Expected active workspaces')

    expect(() => activateWorkspace(db, 'workspace-owner', outsiderWorkspace.id))
      .toThrowError(expect.objectContaining({ statusCode: 403 }))
    expect(db.select({ activeWorkspaceId: users.activeWorkspaceId })
      .from(users).where(eq(users.id, 'workspace-owner')).get())
      .toEqual({ activeWorkspaceId: original.id })
  })
})
