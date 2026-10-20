import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import type { KobiDatabase } from '../server/db'
import { users, workspaceMembers } from '../server/db/schema'
import { acceptInvite, createOrRefreshInvite, inspectInvite, listPendingInvites, removeWorkspaceMember, resendInvite } from '../server/services/workspace-invites'
import { initializeDatabase } from '../server/utils/database'
import { createWorkspaceForUser } from './workspace-fixtures'

describe('workspace invites', () => {
  const databases: Database.Database[] = []

  afterEach(() => {
    for (const database of databases) database.close()
    databases.length = 0
  })

  it('creates, accepts, and invalidates a single-use invite', async () => {
    const sqlite = new Database(':memory:')
    databases.push(sqlite)
    const db = initializeDatabase(sqlite)
    const now = '2026-01-01T00:00:00.000Z'
    db.insert(users).values([
      { id: 'invite-owner', email: 'owner@example.test', name: 'Owner', passwordHash: 'hash', createdAt: now, updatedAt: now },
      { id: 'invite-member', email: 'member@example.test', name: 'Member', passwordHash: 'hash', createdAt: now, updatedAt: now },
    ]).run()
    const workspaceId = createWorkspaceForUser(db, 'invite-owner')

    const created = await createOrRefreshInvite(db, {
      workspaceId,
      invitedBy: 'invite-owner',
      email: 'MEMBER@example.test',
      acceptUrl: token => `https://kobi.test/invite/${token}`,
    })
    expect(created.email).toBe('member@example.test')
    expect(created.emailSent).toBe(false)
    expect(listPendingInvites(db, workspaceId)).toHaveLength(1)
    const token = created.inviteUrl.split('/').at(-1)
    if (!token) throw new Error('Invite URL did not contain a token')
    expect(inspectInvite(db, token)).toMatchObject({ status: 'valid', email: 'member@example.test' })

    expect(acceptInvite(db, { id: 'invite-member', email: 'member@example.test' }, token))
      .toEqual({ workspaceId })
    expect(inspectInvite(db, token)).toMatchObject({ status: 'used' })
    expect(listPendingInvites(db, workspaceId)).toEqual([])
    expect(db.select({ role: workspaceMembers.role }).from(workspaceMembers).where(eq(workspaceMembers.userId, 'invite-member')).get())
      .toEqual({ role: 'member' })
  })

  it('does not allow an invite to be resent during the cooldown window', async () => {
    const sqlite = new Database(':memory:')
    databases.push(sqlite)
    const db = initializeDatabase(sqlite)
    const now = '2026-01-01T00:00:00.000Z'
    db.insert(users).values({ id: 'resend-owner', email: 'owner@example.test', name: 'Owner', passwordHash: 'hash', createdAt: now, updatedAt: now }).run()
    const workspaceId = createWorkspaceForUser(db, 'resend-owner')

    const created = await createOrRefreshInvite(db, {
      workspaceId,
      invitedBy: 'resend-owner',
      email: 'member@example.test',
      acceptUrl: token => `https://kobi.test/invite/${token}`,
    })
    const pending = listPendingInvites(db, workspaceId)
    const pendingInvite = pending.at(0)
    if (!pendingInvite) throw new Error('Expected a pending invite')
    const token = created.inviteUrl.split('/').at(-1)
    if (!token) throw new Error('Expected an invite token')

    await expect(resendInvite(db, {
      workspaceId,
      inviteId: pendingInvite.id,
      invitedBy: 'resend-owner',
      acceptUrl: token => `https://kobi.test/invite/${token}`,
    })).rejects.toMatchObject({ statusCode: 429 })
    expect(inspectInvite(db, token)).toMatchObject({ status: 'valid' })
  })

  it('removes a member and gives them a personal fallback workspace', async () => {
    const sqlite = new Database(':memory:')
    databases.push(sqlite)
    const db: KobiDatabase = initializeDatabase(sqlite)
    const now = '2026-01-01T00:00:00.000Z'
    db.insert(users).values([
      { id: 'remove-owner', email: 'remove-owner@example.test', name: 'Owner', passwordHash: 'hash', createdAt: now, updatedAt: now },
      { id: 'remove-member', email: 'remove-member@example.test', name: 'Member', passwordHash: 'hash', createdAt: now, updatedAt: now },
    ]).run()
    const workspaceId = createWorkspaceForUser(db, 'remove-owner')
    db.insert(workspaceMembers).values({ workspaceId, userId: 'remove-member', role: 'member', joinedAt: now }).run()
    db.update(users).set({ activeWorkspaceId: workspaceId }).where(eq(users.id, 'remove-member')).run()

    removeWorkspaceMember(db, workspaceId, 'remove-member', 'remove-owner')
    expect(db.select({ userId: workspaceMembers.userId }).from(workspaceMembers).where(and(
      eq(workspaceMembers.userId, 'remove-member'),
      eq(workspaceMembers.workspaceId, workspaceId),
    )).get())
      .toEqual(undefined)
    expect(db.select({ activeWorkspaceId: users.activeWorkspaceId }).from(users).where(eq(users.id, 'remove-member')).get()?.activeWorkspaceId)
      .not.toBe(workspaceId)
  })
})
