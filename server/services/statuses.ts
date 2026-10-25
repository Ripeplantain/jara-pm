import { and, asc, eq, ne, sql } from 'drizzle-orm'
import { createError } from 'h3'
import type { CreateStatusInput, ReorderStatusesInput, UpdateStatusInput } from '#shared/schemas/status'
import type { Status, StatusCategory } from '#shared/types/domain'
import type { KobiDb } from '~~/server/db'
import { withTransaction } from '~~/server/db'
import { statuses, tasks } from '~~/server/db/schema'
import type { StatusRow } from '~~/server/types/database'
import { nowIso } from '~~/server/utils/time'

/** The workflow every workspace starts with. Categories are fixed; names can be changed later. */
export const DEFAULT_WORKFLOW: ReadonlyArray<{ name: string, category: StatusCategory, isDefault: boolean }> = [
  { name: 'Backlog', category: 'backlog', isDefault: false },
  { name: 'Todo', category: 'unstarted', isDefault: true },
  { name: 'In Progress', category: 'started', isDefault: false },
  { name: 'Done', category: 'completed', isDefault: false },
  { name: 'Canceled', category: 'canceled', isDefault: false },
]

const statusSelection = {
  id: statuses.id,
  name: statuses.name,
  category: statuses.category,
  position: statuses.position,
  is_default: statuses.isDefault,
}

export const mapStatus = (row: StatusRow): Status => ({
  id: row.id,
  name: row.name,
  category: row.category,
  position: row.position,
  isDefault: Boolean(row.is_default),
})

const statusNotFound = () => {
  throw createError({ status: 404, statusText: 'Status not found' })
}

/** Seeds the fixed five-status workflow. Called inside the transaction that creates the workspace. */
export const seedWorkspaceStatuses = (db: KobiDb, workspaceId: string) => {
  const now = nowIso()
  DEFAULT_WORKFLOW.forEach((entry, position) => {
    db.insert(statuses).values({
      id: crypto.randomUUID(),
      workspaceId,
      name: entry.name,
      category: entry.category,
      position,
      isDefault: entry.isDefault,
      createdAt: now,
      updatedAt: now,
    }).run()
  })
}

export const listStatuses = (db: KobiDb, workspaceId: string): Status[] => {
  const rows = db.select(statusSelection)
    .from(statuses)
    .where(eq(statuses.workspaceId, workspaceId))
    .orderBy(asc(statuses.position), asc(statuses.createdAt))
    .all() as StatusRow[]
  return rows.map(mapStatus)
}

// Reads are always filtered by workspace, so another workspace's status id is indistinguishable
// from one that does not exist and resolves to 404 rather than 403.
export const getStatus = (db: KobiDb, workspaceId: string, statusId: string): Status => {
  const row = db.select(statusSelection)
    .from(statuses)
    .where(and(eq(statuses.id, statusId), eq(statuses.workspaceId, workspaceId)))
    .get() as StatusRow | undefined
  if (!row) return statusNotFound()
  return mapStatus(row)
}

export const requireStatus = getStatus

export const defaultStatus = (db: KobiDb, workspaceId: string): Status => {
  const row = db.select(statusSelection)
    .from(statuses)
    .where(and(eq(statuses.workspaceId, workspaceId), eq(statuses.isDefault, true)))
    .get() as StatusRow | undefined
  if (!row) throw createError({ status: 409, statusText: 'Workspace has no default status' })
  return mapStatus(row)
}

export const defaultStatusId = (db: KobiDb, workspaceId: string): string => defaultStatus(db, workspaceId).id

/** The lowest-position status of a category, or null when the workspace has none. */
export const statusForCategory = (
  db: KobiDb,
  workspaceId: string,
  category: StatusCategory,
): Status | null => {
  const row = db.select(statusSelection)
    .from(statuses)
    .where(and(eq(statuses.workspaceId, workspaceId), eq(statuses.category, category)))
    .orderBy(asc(statuses.position), asc(statuses.createdAt))
    .get() as StatusRow | undefined
  return row ? mapStatus(row) : null
}

const assertNameFree = (db: KobiDb, workspaceId: string, name: string, exceptId?: string) => {
  const clash = db.select({ id: statuses.id })
    .from(statuses)
    .where(and(eq(statuses.workspaceId, workspaceId), sql`lower(${statuses.name}) = lower(${name})`))
    .get()
  if (clash && clash.id !== exceptId) {
    throw createError({ status: 409, statusText: 'A status with that name already exists' })
  }
}

// New tasks land in the default status, so it must be an open one: a default in a completed or
// canceled category would create every task already finished.
const assertCanBeDefault = (status: Status) => {
  if (status.category === 'completed' || status.category === 'canceled') {
    throw createError({ status: 422, statusText: 'The default status must be an open status' })
  }
}

export const createStatus = (
  db: KobiDb,
  _userId: string,
  workspaceId: string,
  input: CreateStatusInput,
): Status => {
  assertNameFree(db, workspaceId, input.name)
  const id = crypto.randomUUID()
  const now = nowIso()
  const next = db.select({ position: sql<number>`coalesce(max(${statuses.position}), -1) + 1` })
    .from(statuses)
    .where(eq(statuses.workspaceId, workspaceId))
    .get()
  db.insert(statuses).values({
    id,
    workspaceId,
    name: input.name,
    category: input.category,
    position: next?.position ?? 0,
    isDefault: false,
    createdAt: now,
    updatedAt: now,
  }).run()
  return getStatus(db, workspaceId, id)
}

export const updateStatus = (
  db: KobiDb,
  _userId: string,
  workspaceId: string,
  statusId: string,
  input: UpdateStatusInput,
): Status => {
  const current = getStatus(db, workspaceId, statusId)
  const name = input.name ?? current.name
  if (input.name !== undefined) assertNameFree(db, workspaceId, name, statusId)
  if (input.isDefault) assertCanBeDefault(current)
  withTransaction(db, (tx) => {
    // The partial unique index allows one default per workspace, so the old default is cleared
    // before the new one is set, inside one transaction -- never observable as zero or two.
    if (input.isDefault && !current.isDefault) {
      tx.update(statuses)
        .set({ isDefault: false, updatedAt: nowIso() })
        .where(and(eq(statuses.workspaceId, workspaceId), eq(statuses.isDefault, true)))
        .run()
    }
    tx.update(statuses)
      .set({
        name,
        isDefault: input.isDefault ? true : current.isDefault,
        updatedAt: nowIso(),
      })
      .where(and(eq(statuses.id, statusId), eq(statuses.workspaceId, workspaceId)))
      .run()
  })
  return getStatus(db, workspaceId, statusId)
}

export const reorderStatuses = (
  db: KobiDb,
  _userId: string,
  workspaceId: string,
  input: ReorderStatusesInput,
): Status[] => {
  const existing = listStatuses(db, workspaceId).map(status => status.id)
  const requested = new Set(input.statusIds)
  if (
    requested.size !== input.statusIds.length
    || requested.size !== existing.length
    || existing.some(id => !requested.has(id))
  ) {
    throw createError({ status: 422, statusText: 'Reorder must list every workspace status exactly once' })
  }
  const now = nowIso()
  withTransaction(db, (tx) => {
    input.statusIds.forEach((id, position) => {
      tx.update(statuses)
        .set({ position, updatedAt: now })
        .where(and(eq(statuses.id, id), eq(statuses.workspaceId, workspaceId)))
        .run()
    })
  })
  return listStatuses(db, workspaceId)
}

export const deleteStatus = (
  db: KobiDb,
  _userId: string,
  workspaceId: string,
  statusId: string,
  replacementStatusId?: string,
) => {
  const target = getStatus(db, workspaceId, statusId)
  const all = listStatuses(db, workspaceId)
  if (all.length <= 1) {
    throw createError({ status: 409, statusText: 'A workspace must keep at least one status' })
  }
  if (target.category === 'completed' && all.filter(status => status.category === 'completed').length === 1) {
    throw createError({ status: 409, statusText: 'A workspace must keep at least one completed status' })
  }
  const referenced = db.select({ count: sql<number>`count(*)` })
    .from(tasks)
    .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.statusId, statusId)))
    .get()?.count ?? 0
  if ((referenced > 0 || target.isDefault) && !replacementStatusId) {
    throw createError({ status: 409, statusText: 'Choose a replacement status for this status' })
  }
  if (replacementStatusId === statusId) {
    throw createError({ status: 422, statusText: 'The replacement must be a different status' })
  }
  const replacement = replacementStatusId ? getStatus(db, workspaceId, replacementStatusId) : null
  if (replacement && target.isDefault) assertCanBeDefault(replacement)

  // A bulk reassignment cannot run the recurring-successor logic that `updateTask` runs, and
  // stamping `completedAt` here would end the chain for good: `shouldSchedule` requires a null
  // marker, and reopening a recurring occurrence deliberately keeps it. Refusing is the same
  // answer `createTask` gives for a recurring task that starts closed.
  if (replacement && (replacement.category === 'completed' || replacement.category === 'canceled')) {
    const recurring = db.select({ count: sql<number>`count(*)` })
      .from(tasks)
      .where(and(
        eq(tasks.workspaceId, workspaceId),
        eq(tasks.statusId, statusId),
        ne(tasks.recurrence, 'none'),
      ))
      .get()?.count ?? 0
    if (recurring > 0) {
      throw createError({
        status: 422,
        statusText: 'Move recurring work to an open status before deleting this one',
      })
    }
  }

  withTransaction(db, (tx) => {
    const now = nowIso()
    if (replacement) {
      // Reassigned tasks keep the markers their new category implies, so a task moved into a
      // completed status is not left without `completedAt` and one moved out is not left with it.
      tx.update(tasks)
        .set({
          statusId: replacement.id,
          updatedAt: now,
          completedAt: replacement.category === 'completed'
            ? sql`coalesce(${tasks.completedAt}, ${now})`
            : sql`case when ${tasks.recurrence} = 'none' then null else ${tasks.completedAt} end`,
          startedAt: replacement.category === 'started'
            ? sql`coalesce(${tasks.startedAt}, ${now})`
            : tasks.startedAt,
        })
        .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.statusId, statusId)))
        .run()
      if (target.isDefault) {
        tx.update(statuses)
          .set({ isDefault: false, updatedAt: now })
          .where(and(eq(statuses.id, statusId), eq(statuses.workspaceId, workspaceId)))
          .run()
        tx.update(statuses)
          .set({ isDefault: true, updatedAt: now })
          .where(and(eq(statuses.id, replacement.id), eq(statuses.workspaceId, workspaceId)))
          .run()
      }
    }
    tx.delete(statuses)
      .where(and(eq(statuses.id, statusId), eq(statuses.workspaceId, workspaceId)))
      .run()
    // Close the gap so positions stay dense.
    const remaining = tx.select({ id: statuses.id })
      .from(statuses)
      .where(eq(statuses.workspaceId, workspaceId))
      .orderBy(asc(statuses.position), asc(statuses.createdAt))
      .all()
    remaining.forEach((row, position) => {
      tx.update(statuses).set({ position, updatedAt: now }).where(eq(statuses.id, row.id)).run()
    })
  })
}
