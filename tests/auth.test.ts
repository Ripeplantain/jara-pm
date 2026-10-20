import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createUserWithPersonalWorkspace } from '../server/services/auth'
import { users, workspaceMembers, workspaces } from '../server/db/schema'
import { initializeDatabase } from '../server/utils/database'

describe('registration workspace foundation', () => {
  const databases: Database.Database[] = []

  afterEach(() => {
    for (const database of databases) database.close()
    databases.length = 0
  })

  it('creates the user, personal workspace, owner membership, and active workspace together', () => {
    const sqlite = new Database(':memory:')
    databases.push(sqlite)
    const db = initializeDatabase(sqlite)

    const result = createUserWithPersonalWorkspace(db, {
      email: 'new@example.test',
      name: 'New User',
      passwordHash: 'test-hash',
    })

    expect(db.select({ id: users.id, activeWorkspaceId: users.activeWorkspaceId })
      .from(users).where(eq(users.id, result.user.id)).get())
      .toEqual({ id: result.user.id, activeWorkspaceId: result.workspaceId })
    expect(db.select({ name: workspaces.name, ownerId: workspaces.ownerId })
      .from(workspaces).where(eq(workspaces.id, result.workspaceId)).get())
      .toEqual({ name: "New User's workspace", ownerId: result.user.id })
    expect(db.select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, result.workspaceId)).get())
      .toEqual({ role: 'owner' })
  })
})
