import { and, asc, eq, gt, isNull } from 'drizzle-orm'
import { createError } from 'h3'
import { createHash, randomBytes } from 'node:crypto'
import type { KobiDatabase, KobiDb } from '~~/server/db'
import { tasks, users, workspaceInvites, workspaceMembers, workspaces } from '~~/server/db/schema'
import { nowIso } from '~~/server/utils/time'
import { sendInviteEmail } from '~~/server/services/mailer'
import { allocateWorkspaceKey } from '~~/server/services/workspace'

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const OWNER_INVITE_LIMIT = 10
const OWNER_INVITE_WINDOW_MS = 60 * 60 * 1000
const RESEND_WINDOW_MS = 60 * 1000

const ownerInviteAttempts = new Map<string, number[]>()

const normalizeEmail = (email: string) => email.trim().toLowerCase()
const createRawToken = () => randomBytes(32).toString('hex')
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')
const expiryIso = () => new Date(Date.now() + INVITE_TTL_MS).toISOString()

const pendingInviteWhere = (workspaceId: string, email: string) => and(
  eq(workspaceInvites.workspaceId, workspaceId),
  eq(workspaceInvites.email, email),
  isNull(workspaceInvites.acceptedAt),
  isNull(workspaceInvites.revokedAt),
)

const assertInviteRateLimit = (workspaceId: string) => {
  const cutoff = Date.now() - OWNER_INVITE_WINDOW_MS
  const attempts = (ownerInviteAttempts.get(workspaceId) ?? []).filter(timestamp => timestamp > cutoff)
  if (attempts.length >= OWNER_INVITE_LIMIT) {
    throw createError({ status: 429, statusText: 'Invite rate limit exceeded' })
  }
  attempts.push(Date.now())
  ownerInviteAttempts.set(workspaceId, attempts)
}

const workspaceInviteContext = (db: KobiDb, workspaceId: string, userId: string) => {
  const context = db.select({ workspaceName: workspaces.name, inviterName: users.name })
    .from(workspaces)
    .innerJoin(users, eq(users.id, userId))
    .where(eq(workspaces.id, workspaceId))
    .get()
  if (!context) throw createError({ status: 404, statusText: 'Workspace not found' })
  return context
}

export const listPendingInvites = (db: KobiDb, workspaceId: string) => {
  return db.select({
    id: workspaceInvites.id,
    email: workspaceInvites.email,
    role: workspaceInvites.role,
    expiresAt: workspaceInvites.expiresAt,
    createdAt: workspaceInvites.createdAt,
    lastSentAt: workspaceInvites.lastSentAt,
  })
    .from(workspaceInvites)
    .where(and(
      eq(workspaceInvites.workspaceId, workspaceId),
      isNull(workspaceInvites.acceptedAt),
      isNull(workspaceInvites.revokedAt),
      gt(workspaceInvites.expiresAt, nowIso()),
    ))
    .orderBy(asc(workspaceInvites.createdAt))
    .all()
}

export const createOrRefreshInvite = async (
  db: KobiDatabase,
  input: { workspaceId: string, invitedBy: string, email: string, acceptUrl: (token: string) => string, apiKey?: string, from?: string },
) => {
  assertInviteRateLimit(input.workspaceId)
  const email = normalizeEmail(input.email)
  const existingMember = db.select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, input.workspaceId), eq(users.email, email)))
    .get()
  if (existingMember) throw createError({ status: 409, statusText: 'That person is already a workspace member' })

  const token = createRawToken()
  const now = nowIso()
  const expiresAt = expiryIso()
  const pending = db.select({ id: workspaceInvites.id })
    .from(workspaceInvites)
    .where(pendingInviteWhere(input.workspaceId, email))
    .get()

  if (pending) {
    db.update(workspaceInvites)
      .set({ tokenHash: hashToken(token), expiresAt, lastSentAt: now, revokedAt: null })
      .where(eq(workspaceInvites.id, pending.id))
      .run()
  } else {
    db.insert(workspaceInvites).values({
      id: crypto.randomUUID(),
      workspaceId: input.workspaceId,
      email,
      role: 'member',
      tokenHash: hashToken(token),
      invitedBy: input.invitedBy,
      expiresAt,
      acceptedAt: null,
      acceptedBy: null,
      revokedAt: null,
      lastSentAt: now,
      createdAt: now,
    }).run()
  }

  const context = workspaceInviteContext(db, input.workspaceId, input.invitedBy)
  const emailResult = await sendInviteEmail({
    to: email,
    inviterName: context.inviterName,
    workspaceName: context.workspaceName,
    acceptUrl: input.acceptUrl(token),
    apiKey: input.apiKey,
    from: input.from,
  })
  return { email, expiresAt, inviteUrl: input.acceptUrl(token), emailSent: emailResult.sent }
}

export const resendInvite = async (
  db: KobiDatabase,
  input: { workspaceId: string, inviteId: string, invitedBy: string, acceptUrl: (token: string) => string, apiKey?: string, from?: string },
) => {
  const invite = db.select({
    id: workspaceInvites.id,
    email: workspaceInvites.email,
    lastSentAt: workspaceInvites.lastSentAt,
    expiresAt: workspaceInvites.expiresAt,
  }).from(workspaceInvites).where(and(
    eq(workspaceInvites.id, input.inviteId),
    eq(workspaceInvites.workspaceId, input.workspaceId),
    isNull(workspaceInvites.acceptedAt),
    isNull(workspaceInvites.revokedAt),
  )).get()
  if (!invite) throw createError({ status: 404, statusText: 'Invite not found' })
  if (invite.lastSentAt && Date.now() - Date.parse(invite.lastSentAt) < RESEND_WINDOW_MS) {
    throw createError({ status: 429, statusText: 'Please wait before resending this invite' })
  }

  const token = createRawToken()
  const now = nowIso()
  const expiresAt = expiryIso()
  db.update(workspaceInvites)
    .set({ tokenHash: hashToken(token), expiresAt, lastSentAt: now })
    .where(eq(workspaceInvites.id, invite.id))
    .run()
  const context = workspaceInviteContext(db, input.workspaceId, input.invitedBy)
  const emailResult = await sendInviteEmail({
    to: invite.email,
    inviterName: context.inviterName,
    workspaceName: context.workspaceName,
    acceptUrl: input.acceptUrl(token),
    apiKey: input.apiKey,
    from: input.from,
  })
  return { email: invite.email, expiresAt, inviteUrl: input.acceptUrl(token), emailSent: emailResult.sent }
}

export const revokeInvite = (db: KobiDb, workspaceId: string, inviteId: string) => {
  const result = db.update(workspaceInvites)
    .set({ revokedAt: nowIso() })
    .where(and(
      eq(workspaceInvites.id, inviteId),
      eq(workspaceInvites.workspaceId, workspaceId),
      isNull(workspaceInvites.acceptedAt),
      isNull(workspaceInvites.revokedAt),
    ))
    .run()
  if (!result.changes) throw createError({ status: 404, statusText: 'Invite not found' })
}

export const inspectInvite = (db: KobiDb, token: string) => {
  const invite = db.select({
    email: workspaceInvites.email,
    expiresAt: workspaceInvites.expiresAt,
    acceptedAt: workspaceInvites.acceptedAt,
    revokedAt: workspaceInvites.revokedAt,
    workspaceId: workspaces.id,
    workspaceName: workspaces.name,
    inviterName: users.name,
  }).from(workspaceInvites)
    .innerJoin(workspaces, eq(workspaces.id, workspaceInvites.workspaceId))
    .innerJoin(users, eq(users.id, workspaceInvites.invitedBy))
    .where(eq(workspaceInvites.tokenHash, hashToken(token)))
    .get()
  if (!invite) return { status: 'not_found' as const }
  if (invite.acceptedAt) return { status: 'used' as const, workspaceName: invite.workspaceName }
  if (invite.revokedAt) return { status: 'revoked' as const, workspaceName: invite.workspaceName }
  if (Date.parse(invite.expiresAt) <= Date.now()) return { status: 'expired' as const, workspaceName: invite.workspaceName }
  return {
    status: 'valid' as const,
    email: invite.email,
    maskedEmail: invite.email.replace(/^(.).+(@.*)$/, '$1***$2'),
    expiresAt: invite.expiresAt,
    workspaceId: invite.workspaceId,
    workspaceName: invite.workspaceName,
    inviterName: invite.inviterName,
  }
}

export const acceptInvite = (db: KobiDatabase, user: { id: string, email: string }, token: string) => {
  const now = nowIso()
  const invite = db.select({
    id: workspaceInvites.id,
    workspaceId: workspaceInvites.workspaceId,
    email: workspaceInvites.email,
    expiresAt: workspaceInvites.expiresAt,
  }).from(workspaceInvites).where(and(
    eq(workspaceInvites.tokenHash, hashToken(token)),
    isNull(workspaceInvites.acceptedAt),
    isNull(workspaceInvites.revokedAt),
  )).get()
  if (!invite) throw createError({ status: 409, statusText: 'Invite is invalid or already used' })
  if (Date.parse(invite.expiresAt) <= Date.now()) throw createError({ status: 410, statusText: 'Invite has expired' })
  if (normalizeEmail(user.email) !== invite.email) throw createError({ status: 403, statusText: 'Invite email does not match your account' })

  db.transaction((tx) => {
    const updated = tx.update(workspaceInvites)
      .set({ acceptedAt: now, acceptedBy: user.id })
      .where(and(
        eq(workspaceInvites.id, invite.id),
        isNull(workspaceInvites.acceptedAt),
        isNull(workspaceInvites.revokedAt),
      ))
      .run()
    if (!updated.changes) throw createError({ status: 409, statusText: 'Invite is invalid or already used' })
    tx.insert(workspaceMembers).values({
      workspaceId: invite.workspaceId,
      userId: user.id,
      role: 'member',
      joinedAt: now,
    }).onConflictDoNothing().run()
    tx.update(users).set({ activeWorkspaceId: invite.workspaceId, updatedAt: now }).where(eq(users.id, user.id)).run()
  })
  return { workspaceId: invite.workspaceId }
}

export const removeWorkspaceMember = (db: KobiDatabase, workspaceId: string, userId: string, requesterId: string) => {
  if (userId === requesterId) throw createError({ status: 422, statusText: 'Owners cannot remove themselves' })
  const member = db.select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .get()
  if (!member) throw createError({ status: 404, statusText: 'Member not found' })
  if (member.role === 'owner') throw createError({ status: 422, statusText: 'The workspace owner cannot be removed' })

  db.transaction((tx) => {
    tx.update(tasks)
      .set({ assigneeId: null, updatedAt: nowIso() })
      .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.assigneeId, userId)))
      .run()
    tx.delete(workspaceMembers).where(and(
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.userId, userId),
    )).run()
    const user = tx.select({ activeWorkspaceId: users.activeWorkspaceId, updatedAt: users.updatedAt })
      .from(users).where(eq(users.id, userId)).get()
    if (user?.activeWorkspaceId !== workspaceId) return
    const fallback = tx.select({ id: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, userId))
      .orderBy(asc(workspaceMembers.joinedAt))
      .get()
    let fallbackId = fallback?.id
    if (!fallbackId) {
      fallbackId = crypto.randomUUID()
      const now = nowIso()
      tx.insert(workspaces).values({
        id: fallbackId,
        name: 'Personal workspace',
        key: allocateWorkspaceKey(tx, 'Personal workspace'),
        ownerId: userId,
        createdAt: now,
        updatedAt: now,
      }).run()
      tx.insert(workspaceMembers).values({ workspaceId: fallbackId, userId, role: 'owner', joinedAt: now }).run()
    }
    tx.update(users).set({ activeWorkspaceId: fallbackId, updatedAt: nowIso() }).where(eq(users.id, userId)).run()
  })
}
