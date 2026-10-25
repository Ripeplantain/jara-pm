import { and, asc, desc, eq, inArray, isNotNull, or, sql } from 'drizzle-orm'
import { createError } from 'h3'
import type {
  CreateLabelGroupInput,
  CreateLabelInput,
  UpdateLabelGroupInput,
  UpdateLabelInput,
} from '#shared/schemas/label'
import type { Label, LabelCollection, LabelGroup } from '#shared/types/domain'
import type { KobiDb } from '~~/server/db'
import { withTransaction } from '~~/server/db'
import { labelGroups, labels, taskLabels, tasks } from '~~/server/db/schema'
import type { LabelGroupRow, LabelRow } from '~~/server/types/database'
import { nowIso } from '~~/server/utils/time'

const labelSelection = {
  id: labels.id,
  group_id: labels.groupId,
  group_name: labelGroups.name,
  name: labels.name,
  color: labels.color,
  description: labels.description,
  archived_at: labels.archivedAt,
}

const mapLabel = (row: LabelRow): Label => ({
  id: row.id,
  groupId: row.group_id,
  groupName: row.group_name,
  name: row.name,
  color: row.color,
  description: row.description,
  archivedAt: row.archived_at,
})

const mapLabelGroup = (row: LabelGroupRow): LabelGroup => ({
  id: row.id,
  name: row.name,
  position: row.position,
})

const labelNotFound = () => {
  throw createError({ status: 404, statusText: 'Label not found' })
}

// Reads are always filtered by workspace, so a label id belonging to another workspace is
// indistinguishable from one that does not exist and resolves to 404 rather than 403.
const requireLabel = (db: KobiDb, workspaceId: string, labelId: string) => {
  const row = db.select({
    id: labels.id,
    group_id: labels.groupId,
    name: labels.name,
    color: labels.color,
    description: labels.description,
    archived_at: labels.archivedAt,
  })
    .from(labels)
    .where(and(eq(labels.id, labelId), eq(labels.workspaceId, workspaceId)))
    .get()
  if (!row) return labelNotFound()
  return row
}

const requireLabelGroup = (db: KobiDb, workspaceId: string, groupId: string | null) => {
  if (!groupId) return null
  const group = db.select({ id: labelGroups.id })
    .from(labelGroups)
    .where(and(eq(labelGroups.id, groupId), eq(labelGroups.workspaceId, workspaceId)))
    .get()
  if (!group) throw createError({ status: 422, statusText: 'Label group is not available' })
  return group.id
}

const assertNameFree = (db: KobiDb, workspaceId: string, name: string, exceptId?: string) => {
  const clash = db.select({ id: labels.id })
    .from(labels)
    .where(and(
      eq(labels.workspaceId, workspaceId),
      sql`lower(${labels.name}) = lower(${name})`,
    ))
    .get()
  if (clash && clash.id !== exceptId) {
    throw createError({ status: 409, statusText: 'A label with that name already exists' })
  }
}

export const listLabelGroups = (db: KobiDb, workspaceId: string): LabelGroup[] => {
  const rows = db.select({ id: labelGroups.id, name: labelGroups.name, position: labelGroups.position })
    .from(labelGroups)
    .where(eq(labelGroups.workspaceId, workspaceId))
    .orderBy(asc(labelGroups.position), asc(labelGroups.createdAt))
    .all() as LabelGroupRow[]
  return rows.map(mapLabelGroup)
}

export const listLabels = (
  db: KobiDb,
  workspaceId: string,
  options: { includeArchived?: boolean } = {},
): LabelCollection => {
  const conditions = [eq(labels.workspaceId, workspaceId)]
  if (!options.includeArchived) conditions.push(sql`${labels.archivedAt} is null`)
  const rows = db.select(labelSelection)
    .from(labels)
    .leftJoin(labelGroups, and(
      eq(labelGroups.id, labels.groupId),
      eq(labelGroups.workspaceId, labels.workspaceId),
    ))
    .where(and(...conditions))
    .orderBy(asc(labelGroups.position), asc(labelGroups.name), asc(labels.name))
    .all() as LabelRow[]
  return { groups: listLabelGroups(db, workspaceId), labels: rows.map(mapLabel) }
}

export const getLabel = (db: KobiDb, workspaceId: string, labelId: string): Label => {
  const row = db.select(labelSelection)
    .from(labels)
    .leftJoin(labelGroups, and(
      eq(labelGroups.id, labels.groupId),
      eq(labelGroups.workspaceId, labels.workspaceId),
    ))
    .where(and(eq(labels.id, labelId), eq(labels.workspaceId, workspaceId)))
    .get() as LabelRow | undefined
  if (!row) return labelNotFound()
  return mapLabel(row)
}

export const createLabel = (
  db: KobiDb,
  _userId: string,
  workspaceId: string,
  input: CreateLabelInput,
): Label => {
  const groupId = requireLabelGroup(db, workspaceId, input.groupId)
  assertNameFree(db, workspaceId, input.name)
  const id = crypto.randomUUID()
  const now = nowIso()
  db.insert(labels).values({
    id,
    workspaceId,
    groupId,
    name: input.name,
    color: input.color,
    description: input.description,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  }).run()
  return getLabel(db, workspaceId, id)
}

// Regrouping a label can leave a task holding two of the new group's labels, which the pickers
// would render as two selected radios. Collapsing keeps the most recently attached one, the same
// rule `detachGroupSiblings` applies when a grouped label is attached.
const collapseGroupDuplicates = (db: KobiDb, workspaceId: string, groupId: string) => {
  const siblings = db.select({ id: labels.id })
    .from(labels)
    .where(and(eq(labels.workspaceId, workspaceId), eq(labels.groupId, groupId)))
    .all()
    .map(row => row.id)
  if (siblings.length < 2) return
  const rows = db.select({
    taskId: taskLabels.taskId,
    labelId: taskLabels.labelId,
  })
    .from(taskLabels)
    .where(inArray(taskLabels.labelId, siblings))
    .orderBy(asc(taskLabels.taskId), desc(taskLabels.createdAt), desc(taskLabels.labelId))
    .all()

  const kept = new Set<string>()
  for (const row of rows) {
    if (!kept.has(row.taskId)) {
      kept.add(row.taskId)
      continue
    }
    db.delete(taskLabels)
      .where(and(eq(taskLabels.taskId, row.taskId), eq(taskLabels.labelId, row.labelId)))
      .run()
  }
}

export const updateLabel = (
  db: KobiDb,
  _userId: string,
  workspaceId: string,
  labelId: string,
  input: UpdateLabelInput,
): Label => {
  const current = requireLabel(db, workspaceId, labelId)
  const groupId = input.groupId === undefined ? current.group_id : requireLabelGroup(db, workspaceId, input.groupId)
  const name = input.name ?? current.name
  if (input.name !== undefined) assertNameFree(db, workspaceId, name, labelId)
  // Archiving hides the label from pickers; the task_labels rows are deliberately left in
  // place so historical tasks keep showing what they were labelled with.
  const archivedAt = input.archived === undefined
    ? current.archived_at
    : input.archived ? current.archived_at ?? nowIso() : null
  // The write and the collapse share one transaction, so the group is never observable with
  // two of its labels on the same task.
  withTransaction(db, (tx) => {
    tx.update(labels)
      .set({
        groupId,
        name,
        color: input.color ?? current.color,
        description: input.description ?? current.description,
        archivedAt,
        updatedAt: nowIso(),
      })
      .where(and(eq(labels.id, labelId), eq(labels.workspaceId, workspaceId)))
      .run()
    if (groupId && groupId !== current.group_id) collapseGroupDuplicates(tx, workspaceId, groupId)
  })
  return getLabel(db, workspaceId, labelId)
}

export const deleteLabel = (db: KobiDb, _userId: string, workspaceId: string, labelId: string) => {
  const result = db.delete(labels)
    .where(and(eq(labels.id, labelId), eq(labels.workspaceId, workspaceId)))
    .run()
  if (!result.changes) labelNotFound()
}

export const createLabelGroup = (
  db: KobiDb,
  _userId: string,
  workspaceId: string,
  input: CreateLabelGroupInput,
): LabelGroup => {
  const clash = db.select({ id: labelGroups.id })
    .from(labelGroups)
    .where(and(eq(labelGroups.workspaceId, workspaceId), sql`lower(${labelGroups.name}) = lower(${input.name})`))
    .get()
  if (clash) throw createError({ status: 409, statusText: 'A label group with that name already exists' })

  const id = crypto.randomUUID()
  const now = nowIso()
  const next = db.select({ position: sql<number>`coalesce(max(${labelGroups.position}), -1) + 1` })
    .from(labelGroups)
    .where(eq(labelGroups.workspaceId, workspaceId))
    .get()
  db.insert(labelGroups).values({
    id,
    workspaceId,
    name: input.name,
    position: next?.position ?? 0,
    createdAt: now,
    updatedAt: now,
  }).run()
  return { id, name: input.name, position: next?.position ?? 0 }
}

export const updateLabelGroup = (
  db: KobiDb,
  _userId: string,
  workspaceId: string,
  groupId: string,
  input: UpdateLabelGroupInput,
): LabelGroup => {
  const current = db.select({ name: labelGroups.name, position: labelGroups.position })
    .from(labelGroups)
    .where(and(eq(labelGroups.id, groupId), eq(labelGroups.workspaceId, workspaceId)))
    .get()
  if (!current) throw createError({ status: 404, statusText: 'Label group not found' })
  const name = input.name ?? current.name
  const position = input.position ?? current.position
  db.update(labelGroups)
    .set({ name, position, updatedAt: nowIso() })
    .where(and(eq(labelGroups.id, groupId), eq(labelGroups.workspaceId, workspaceId)))
    .run()
  return { id: groupId, name, position }
}

export const deleteLabelGroup = (db: KobiDb, _userId: string, workspaceId: string, groupId: string) => {
  // `labels.group_id` is ON DELETE SET NULL, so the group's labels survive as ungrouped
  // (multi-select) labels rather than disappearing from the tasks carrying them.
  const result = db.delete(labelGroups)
    .where(and(eq(labelGroups.id, groupId), eq(labelGroups.workspaceId, workspaceId)))
    .run()
  if (!result.changes) throw createError({ status: 404, statusText: 'Label group not found' })
}

// --- task labels -------------------------------------------------------------------------

// A project-less task is private to the user who created it, so workspace membership alone is
// not enough to label it. This repeats the visibility predicate `server/services/tasks.ts` uses
// for every task read and write: without it a member could write labels onto another member's
// Inbox task.
const requireVisibleTask = (db: KobiDb, userId: string, workspaceId: string, taskId: string) => {
  const task = db.select({ id: tasks.id })
    .from(tasks)
    .where(and(
      eq(tasks.id, taskId),
      eq(tasks.workspaceId, workspaceId),
      or(isNotNull(tasks.projectId), eq(tasks.userId, userId)),
    ))
    .get()
  if (!task) throw createError({ status: 404, statusText: 'Task not found' })
  return task.id
}

export const labelsForTasks = (
  db: KobiDb,
  workspaceId: string,
  taskIds: string[],
): Map<string, Label[]> => {
  const grouped = new Map<string, Label[]>()
  if (taskIds.length === 0) return grouped
  // One query for the whole page rather than one per task: hydration must not turn a list
  // read into N+1 queries.
  const rows = db.select({ ...labelSelection, task_id: taskLabels.taskId })
    .from(taskLabels)
    .innerJoin(labels, and(eq(labels.id, taskLabels.labelId), eq(labels.workspaceId, workspaceId)))
    .leftJoin(labelGroups, and(
      eq(labelGroups.id, labels.groupId),
      eq(labelGroups.workspaceId, labels.workspaceId),
    ))
    .where(inArray(taskLabels.taskId, taskIds))
    .orderBy(asc(labelGroups.position), asc(labelGroups.name), asc(labels.name))
    .all() as Array<LabelRow & { task_id: string }>

  for (const row of rows) {
    const existing = grouped.get(row.task_id)
    const label = mapLabel(row)
    if (existing) existing.push(label)
    else grouped.set(row.task_id, [label])
  }
  return grouped
}

// A label inside a group is single-select, mirroring Linear's label groups: attaching one
// detaches whichever sibling was already on the task. Ungrouped labels are multi-select.
const detachGroupSiblings = (db: KobiDb, workspaceId: string, taskId: string, groupId: string | null) => {
  if (!groupId) return
  const siblings = db.select({ id: labels.id })
    .from(labels)
    .where(and(eq(labels.workspaceId, workspaceId), eq(labels.groupId, groupId)))
    .all()
    .map(row => row.id)
  if (siblings.length === 0) return
  db.delete(taskLabels)
    .where(and(eq(taskLabels.taskId, taskId), inArray(taskLabels.labelId, siblings)))
    .run()
}

export const attachTaskLabel = (
  db: KobiDb,
  userId: string,
  workspaceId: string,
  taskId: string,
  labelId: string,
) => {
  requireVisibleTask(db, userId, workspaceId, taskId)
  const label = requireLabel(db, workspaceId, labelId)
  // The sibling removal and the insert share one transaction, so a grouped swap is never
  // observable as "both labels attached" or "neither attached".
  withTransaction(db, (tx) => {
    detachGroupSiblings(tx, workspaceId, taskId, label.group_id)
    tx.insert(taskLabels)
      .values({ taskId, labelId, createdAt: nowIso() })
      .onConflictDoNothing()
      .run()
  })
}

export const detachTaskLabel = (
  db: KobiDb,
  userId: string,
  workspaceId: string,
  taskId: string,
  labelId: string,
) => {
  requireVisibleTask(db, userId, workspaceId, taskId)
  requireLabel(db, workspaceId, labelId)
  db.delete(taskLabels)
    .where(and(eq(taskLabels.taskId, taskId), eq(taskLabels.labelId, labelId)))
    .run()
}

// Replaces a task's labels wholesale. Grouped labels still collapse to one per group: when a
// caller sends two siblings the last one wins, which keeps the single-select rule true no
// matter which surface wrote the set.
//
// Precondition: `taskId` has already been proved visible to the caller. Both callers are
// `createTask`/`updateTask`, which scope the task by user before reaching here; anything new
// calling this must go through `requireVisibleTask` first.
export const setTaskLabels = (
  db: KobiDb,
  workspaceId: string,
  taskId: string,
  labelIds: string[],
) => {
  const resolved = labelIds.map(labelId => requireLabel(db, workspaceId, labelId))
  const keep = new Map<string, string>()
  for (const label of resolved) {
    keep.set(label.group_id ?? `ungrouped:${label.id}`, label.id)
  }
  const now = nowIso()
  withTransaction(db, (tx) => {
    tx.delete(taskLabels).where(eq(taskLabels.taskId, taskId)).run()
    const values = [...keep.values()].map(labelId => ({ taskId, labelId, createdAt: now }))
    if (values.length > 0) tx.insert(taskLabels).values(values).run()
  })
}
