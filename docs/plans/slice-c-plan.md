# Slice C — Rhythm: implementation plan

Planner output for `docs/plans/linear-adoption.md` §6 (C1, C2), §7, §8. Branch `feat/linear-slice-a`,
on top of A (`d084b63`) and B (`d60bad4`). Latest migration is `drizzle/0006_past_rick_jones.sql`.

**Nothing in this plan may be executed yet.** Both sub-slices change the SQLite schema, so both are
hard checkpoints under `.agent/rules/checkpoints.md`. No edit to `server/db/schema.ts`, no
`npm run db:generate`, no migration file, until the exact edit below has a yes. A yes covers one
migration only.

Sizing: C1 is L4 in practice (irreversible data operation, §"Task sizing" in
`.agent/rules/engineering.md`), C2 is L3. Workflow: planner → implementer → tester → reviewer, stop
at the commit checkpoint. No evaluator pass is planned — see open decision **D9**.

---

## 1. Migration waves: two, not one

**Recommendation: two migrations and two checkpoints. `0007` for C1, `0008` for C2.**

The brief mandates grouping only for Slice A ("Group Slice A's three schema changes into one
migration wave and one checkpoint"), and the §11 checklist already carries a separate schema
checkpoint line under C1 and under C2.

Reasons to keep them apart:

1. **C1 is irreversible and C2 is not.** `0007` drops `tasks.status` after a backfill. `0008` only
   adds a table, a nullable column and four defaulted workspace columns. Merging them means an
   operator who has to restore a backup because the backfill mapped something wrong also loses the
   cycles work, and a single `drizzle-kit generate` would interleave a destructive table rebuild
   with additive statements in one file — which is exactly the shape that went wrong in `0006`,
   where the generator emitted the rebuild's `INSERT ... SELECT` before the columns it reads exist.
2. **C1 must be verifiable alone.** The acceptance criterion "every pre-existing task ends with a
   correct `statusId` and no nulls" is a property of one migration applied to a pre-C1 database.
   A combined file makes the replay test in `tests/database.test.ts` assert two unrelated things at
   once.
3. **Each sub-slice is independently shippable** and ends at its own commit checkpoint (§8.7). C1
   alone is a coherent release; C2 depends on C1's categories (rollover and velocity are defined in
   terms of `completed` / `canceled`) so the order is forced anyway.
4. Nothing is gained by merging: migrations are append-only, applied in order, each inside its own
   transaction by `migrate()` in `server/utils/database.ts`.

Cost of two waves: `workspaces` and `tasks` are rebuilt twice (SQLite cannot `ALTER TABLE ADD
COLUMN` a column carrying a `CHECK`, so Drizzle rebuilds). That is a copy of two small tables on one
extra boot, and it is the price of a reviewable, separately revertible first wave.

---

## 2. C1 — exact `server/db/schema.ts` edit

### 2.1 New table, inserted after `taskDaySelections` and before `labelGroups`

```ts
export const statuses = sqliteTable('statuses', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  category: text('category').notNull().$type<StatusCategory>(),
  position: integer('position').notNull().default(0),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [
  check(
    'statuses_category_check',
    sql`${table.category} in ('backlog', 'unstarted', 'started', 'completed', 'canceled')`,
  ),
  check('statuses_is_default_check', sql`${table.isDefault} in (0, 1)`),
  unique('statuses_workspace_name_unique').on(table.workspaceId, table.name),
  index('idx_statuses_workspace_position').on(table.workspaceId, table.position),
  index('idx_statuses_workspace_category').on(table.workspaceId, table.category),
  // At most one default per workspace, enforced by the database rather than by a service rule.
  // Same partial-index shape as `workspace_invites_pending_email_unique`. "At least one" cannot
  // be expressed declaratively in SQLite and stays a service invariant (see 2.5).
  uniqueIndex('statuses_workspace_default_unique')
    .on(table.workspaceId)
    .where(sql`${table.isDefault} = 1`),
])
```

`integer(..., { mode: 'boolean' })` is new to this schema — there is no boolean column today. The
redundant `in (0, 1)` check is there so hand-written SQL and the migration backfill cannot store a 2.

`StatusCategory` is imported alongside the existing type imports on line 3:

```ts
import type { EstimateScale, LabelColor, StatusCategory } from '#shared/types/domain'
```

### 2.2 `tasks` (schema.ts:103-141) — three changes

Remove from the column list:

```ts
  status: text('status').notNull().$type<'todo' | 'in_progress' | 'done'>().default('todo'),
```

Add, in its place:

```ts
  statusId: text('status_id').notNull().references(() => statuses.id),
  startedAt: text('started_at'),
```

`statusId` deliberately takes **no** `onDelete` action (SQLite `NO ACTION`). `cascade` would delete
tasks when a status is deleted; `set null` is impossible on a `NOT NULL` column. With enforcement on
at runtime, deleting a referenced status raises a constraint error, which is the backstop behind the
service rule in 2.5 that a delete must name a replacement status.

In the constraint/index list, remove:

```ts
  check('tasks_status_check', sql`${table.status} in ('todo', 'in_progress', 'done')`),
  index('idx_tasks_user_status').on(table.userId, table.status),
  index('idx_tasks_workspace_status').on(table.workspaceId, table.status),
```

and add:

```ts
  index('idx_tasks_user_status_id').on(table.userId, table.statusId),
  index('idx_tasks_workspace_status_id').on(table.workspaceId, table.statusId),
```

Renamed rather than repointed: the table is rebuilt and every index recreated anyway, and an index
named `..._status` that indexes `status_id` would mislead the next person grepping for the column.

### 2.3 Registration

```ts
export const schema = {
  users,
  workspaces,
  workspaceMembers,
  goals,
  projects,
  milestones,
  tasks,
  taskDaySelections,
  statuses,
  labelGroups,
  labels,
  taskLabels,
  workspaceInvites,
  aiProposals,
  aiMessages,
}
```

### 2.4 Seeded workflow (fixed, not user-definable)

| name | category | position | isDefault |
|---|---|---|---|
| Backlog | `backlog` | 0 | no |
| Todo | `unstarted` | 1 | **yes** |
| In Progress | `started` | 2 | no |
| Done | `completed` | 3 | no |
| Canceled | `canceled` | 4 | no |

Seeded by `0007` for every existing workspace, and by `seedWorkspaceStatuses()` inside
`createWorkspace`'s existing transaction for every new one.

### 2.5 Service-level workflow invariants (not expressible in SQLite)

- Exactly one `isDefault` per workspace: at-most-one by the partial unique index, at-least-one by
  `setDefaultStatus` clearing the old default and setting the new one in one transaction, and by
  `deleteStatus` refusing to remove the default without a named successor.
- A workspace always keeps at least one status, and at least one `completed` status (otherwise no
  task could ever be finished). See open decision **D6**.
- `deleteStatus(id, replacementStatusId)` reassigns every task in one transaction before deleting.
- A status's `category` is immutable after creation in C1 (open decision **D5**).

---

## 3. C1 — migration `0007`, full backfill SQL

Generate with `docker compose run --rm --no-deps app npm run db:generate` (locally:
`npm run db:generate` — Docker is unavailable on this machine), then **hand-edit**, following the
`0006` precedent. Two edits are required for the same two reasons `0006` documents in its header:

1. Drizzle emits the `tasks` rebuild's `INSERT ... SELECT` reading `status_id` and `started_at` from
   the *old* table, where they do not exist. The columns are therefore added nullable and
   backfilled **before** the rebuild, which then carries real values across and enforces `NOT NULL`.
2. Drizzle's `PRAGMA foreign_keys=OFF/ON` statements are removed: migrations run inside one
   transaction where that pragma is a no-op. `server/utils/database.ts` disables enforcement around
   `migrate()` and restores it in a `finally`, which is what makes the `DROP TABLE` step safe.

Proposed file, in order:

```sql
-- Hand-edited after `drizzle-kit generate`, for the same two reasons as 0006:
--   * the generated INSERT ... SELECT for the tasks rebuild referenced `status_id` and
--     `started_at` on the OLD table, where those columns do not exist yet. They are added
--     nullable and backfilled first; the rebuild then enforces NOT NULL and the FK.
--   * Drizzle's `PRAGMA foreign_keys=OFF/ON` statements were removed: migrations run inside one
--     transaction where that pragma is a no-op. `server/utils/database.ts` disables enforcement
--     around migrate() instead, which is what makes the DROP TABLE step below safe.
-- This migration is IRREVERSIBLE: it drops `tasks.status` and `tasks_status_check`. There is no
-- down migration. Back up the database file before the first boot on the new image.
CREATE TABLE `statuses` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "statuses_category_check" CHECK("statuses"."category" in ('backlog', 'unstarted', 'started', 'completed', 'canceled')),
	CONSTRAINT "statuses_is_default_check" CHECK("statuses"."is_default" in (0, 1))
);
--> statement-breakpoint
CREATE INDEX `idx_statuses_workspace_position` ON `statuses` (`workspace_id`,`position`);
--> statement-breakpoint
CREATE INDEX `idx_statuses_workspace_category` ON `statuses` (`workspace_id`,`category`);
--> statement-breakpoint
CREATE UNIQUE INDEX `statuses_workspace_name_unique` ON `statuses` (`workspace_id`,`name`);
--> statement-breakpoint
CREATE UNIQUE INDEX `statuses_workspace_default_unique` ON `statuses` (`workspace_id`) WHERE "statuses"."is_default" = 1;
--> statement-breakpoint
-- Seed the fixed five-status workflow for every existing workspace. Ids must be UUID-shaped:
-- every API route validates ids with `idSchema` (uuid), so a status seeded with any other id
-- could never be selected through the API. v4-shaped, built from randomblob, with the version
-- nibble forced to 4 and the variant nibble to 8/9/a/b.
INSERT INTO `statuses` (`id`, `workspace_id`, `name`, `category`, `position`, `is_default`, `created_at`, `updated_at`)
SELECT
  lower(
    hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2)
    || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2)
    || '-' || hex(randomblob(6))
  ),
  w.`id`,
  seed.`name`,
  seed.`category`,
  seed.`position`,
  seed.`is_default`,
  w.`created_at`,
  w.`created_at`
FROM `workspaces` w
CROSS JOIN (
            SELECT 'Backlog'     AS name, 'backlog'   AS category, 0 AS position, 0 AS is_default
  UNION ALL SELECT 'Todo'            , 'unstarted'                , 1           , 1
  UNION ALL SELECT 'In Progress'     , 'started'                  , 2           , 0
  UNION ALL SELECT 'Done'            , 'completed'                , 3           , 0
  UNION ALL SELECT 'Canceled'        , 'canceled'                 , 4           , 0
) seed;
--> statement-breakpoint
ALTER TABLE `tasks` ADD `status_id` text;
--> statement-breakpoint
ALTER TABLE `tasks` ADD `started_at` text;
--> statement-breakpoint
-- Backfill by CATEGORY, not by name: the seed above guarantees exactly one status per category per
-- workspace, so the correlated subquery is single-valued. `todo` and any unexpected legacy value
-- map to the unstarted status.
UPDATE `tasks`
SET `status_id` = (
  SELECT s.`id` FROM `statuses` s
  WHERE s.`workspace_id` = `tasks`.`workspace_id`
    AND s.`category` = CASE `tasks`.`status`
                         WHEN 'done'        THEN 'completed'
                         WHEN 'in_progress' THEN 'started'
                         ELSE 'unstarted'
                       END
);
--> statement-breakpoint
-- `started_at` records the first move into a `started` category, which history does not hold.
-- A task that is in progress now is stamped with its own `updated_at` -- a real timestamp from
-- the row, and the only evidence available -- because it will never transition into `started`
-- again and would otherwise stay null forever. An already-completed task is left NULL rather
-- than stamped with `completed_at`, which would report a cycle time of zero for every task that
-- existed before this migration. See open decision D2.
UPDATE `tasks`
SET `started_at` = CASE WHEN `status` = 'in_progress' THEN `updated_at` ELSE NULL END;
--> statement-breakpoint
CREATE TABLE `__new_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`assignee_id` text,
	`project_id` text,
	`milestone_id` text,
	`parent_id` text,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status_id` text NOT NULL,
	`started_at` text,
	`priority` text DEFAULT 'none' NOT NULL,
	`due_date` text,
	`scheduled_for` text,
	`recurrence` text DEFAULT 'none' NOT NULL,
	`completed_at` text,
	`estimate` integer,
	`number` integer NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`milestone_id`) REFERENCES `milestones`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`parent_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`status_id`) REFERENCES `statuses`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "tasks_estimate_check" CHECK("__new_tasks"."estimate" is null or ("__new_tasks"."estimate" between 1 and 1000)),
	CONSTRAINT "tasks_priority_check" CHECK("__new_tasks"."priority" in ('none', 'low', 'medium', 'high')),
	CONSTRAINT "tasks_recurrence_check" CHECK("__new_tasks"."recurrence" in ('none', 'daily', 'weekly'))
);
--> statement-breakpoint
-- `status_id` is NOT NULL here, so a task the backfill could not map -- a row whose workspace
-- holds no statuses, which cannot happen after the seed above -- aborts this statement, rolls the
-- whole migration back, and leaves the database exactly as it was. This is the assertion that
-- "no task ends with a null statusId"; there is no need for a separate guard.
INSERT INTO `__new_tasks`("id", "user_id", "workspace_id", "assignee_id", "project_id", "milestone_id", "parent_id", "title", "description", "status_id", "started_at", "priority", "due_date", "scheduled_for", "recurrence", "completed_at", "estimate", "number", "position", "created_at", "updated_at") SELECT "id", "user_id", "workspace_id", "assignee_id", "project_id", "milestone_id", "parent_id", "title", "description", "status_id", "started_at", "priority", "due_date", "scheduled_for", "recurrence", "completed_at", "estimate", "number", "position", "created_at", "updated_at" FROM `tasks`;
--> statement-breakpoint
DROP TABLE `tasks`;
--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;
--> statement-breakpoint
CREATE INDEX `idx_tasks_user_status_id` ON `tasks` (`user_id`,`status_id`);
--> statement-breakpoint
CREATE INDEX `idx_tasks_user_due` ON `tasks` (`user_id`,`due_date`);
--> statement-breakpoint
CREATE INDEX `idx_tasks_workspace_status_id` ON `tasks` (`workspace_id`,`status_id`);
--> statement-breakpoint
CREATE INDEX `idx_tasks_workspace_due` ON `tasks` (`workspace_id`,`due_date`);
--> statement-breakpoint
CREATE INDEX `idx_tasks_workspace_assignee` ON `tasks` (`workspace_id`,`assignee_id`);
--> statement-breakpoint
CREATE INDEX `idx_tasks_project` ON `tasks` (`project_id`,`position`);
--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_workspace_number_unique` ON `tasks` (`workspace_id`,`number`);
```

The exact column order and `__new_tasks` spelling come from the generator; the hand-edit only moves
statements and drops the pragmas. The generated file is reviewed against this plan before it runs.

### 3.1 What is irreversible, and what the operator must back up

**Irreversible, with no down migration (this repository has no down files):**

- `tasks.status` and `tasks_status_check` are dropped. The three legacy values are gone from the
  database. If the `todo → unstarted / in_progress → started / done → completed` mapping is wrong,
  the information needed to redo it no longer exists.
- `idx_tasks_user_status` and `idx_tasks_workspace_status` are dropped.
- The seeded status ids are random, so a replay on a restored backup produces different ids. Any
  external reference to a status id (none today) would not survive a restore-and-replay.
- The `tasks` table is dropped and recreated **with foreign key enforcement off**. A defect in the
  `INSERT ... SELECT` would silently lose rows rather than raise. The replay test in §6.4 asserts
  row counts on `tasks`, `task_labels`, `task_day_selections` for exactly this reason.

**Before the first boot on this image, the operator must:**

1. Stop the app (`docker compose stop app`) so nothing is mid-write.
2. Copy the database with SQLite's own backup, not `cp` — a WAL-mode database is three files:
   `sqlite3 <db> ".backup '<db>.pre-0007.bak'"`, or copy `kobi.db`, `kobi.db-wal` and `kobi.db-shm`
   together.
3. Keep that copy off the named volume.
4. Never `docker compose down -v`. Named-volume deletion is a checkpoint
   (`.agent/rules/checkpoints.md`) and is not part of this slice.

Migrations run on the first database open by Nitro, so "before deploying" means before the new
image serves its first request. Until the backup is confirmed, `0007` is run only against
throwaway in-memory databases in the test suite.

---

## 4. C1 — ordered task breakdown and blast radius

Order matters: schema and types first, then the server, then the client, so each step typechecks.

| # | File | Change | Notes |
|---|---|---|---|
| 1 | `shared/types/domain.ts` | Add `STATUS_CATEGORIES` as const + `StatusCategory`; add `WorkspaceStatus = { id, name, category, position, isDefault }`; **remove** `TASK_STATUSES` / `TaskStatus`; change `Task.status` from `TaskStatus` to `WorkspaceStatus`; add `Task.startedAt: string \| null` | the contract change; see **D1** |
| 2 | `server/db/schema.ts` | §2 above | **CHECKPOINT** |
| 3 | `drizzle/0007_*.sql` | §3 above | **CHECKPOINT**, hand-edited |
| 4 | `server/types/database.ts` | `TaskRow.status` → `status_id`, `status_name`, `status_category`, `status_position`, `status_is_default`, `started_at`; new `StatusRow` | 1 type, mechanical |
| 5 | `shared/schemas/status.ts` *(new)* | `createStatusSchema` (name 1-60, `category` enum, no position), `updateStatusSchema` (name only — **D5**), `reorderStatusesSchema` (`statusIds: z.array(idSchema).min(1)`), `deleteStatusQuerySchema` (`replacementStatusId`) | reuse `idSchema`, `titleSchema`-style trim |
| 6 | `shared/schemas/task.ts` | query: drop `status`, add `statusId: idSchema.optional()` and `category: z.enum(STATUS_CATEGORIES).optional()`; fields: drop `status`, add `statusId: idSchema`; create: `statusId` optional (absent = workspace default); update: `statusId` optional; **remove** the `recurrence !== 'none' && status === 'done'` superRefine branch | the Zod-level rule cannot see categories; it moves to the service, which already throws 422. `tests/schemas.test.ts` case moves with it |
| 7 | `server/services/statuses.ts` *(new)* | `seedWorkspaceStatuses`, `listStatuses`, `getStatus`, `requireStatus` (404 on another workspace's id), `defaultStatusId`, `statusForCategory(workspaceId, category)` (lowest position), `createStatus`, `updateStatus`, `reorderStatuses`, `setDefaultStatus`, `deleteStatus(replacementStatusId)` | shaped on `server/services/labels.ts`: `(db, _userId, workspaceId, …)`, workspace-filtered reads, 404 not 403 for foreign ids |
| 8 | `server/services/workspace.ts` | `createWorkspace` calls `seedWorkspaceStatuses(tx, id)` inside the existing transaction | a workspace is never observable without a workflow |
| 9 | `server/services/tasks.ts` | **14 occurrences.** `taskSelection` gains an `innerJoin(statuses, …)` and four status columns; `mapTask` builds the nested object + `startedAt`; new `assertStatus` (422 when the id is not in this workspace); `createTask` resolves `input.statusId ?? defaultStatusId`, sets `completedAt` when the resolved category is `completed`, sets `startedAt` when it is `started`, and rejects a recurring task created in a `completed`/`canceled` category; `updateTask`'s `valuesFor` replaces `status === 'done'` with `category === 'completed'`, and adds **`startedAt: base.startedAt ?? (nextCategory === 'started' ? nowIso() : null)`** — set once, never cleared; the recurrence guards (`current.status === 'done'`, `shouldSchedule`) become category checks; the successor insert's `status: 'todo'` becomes the workspace default status id; `listTasks` filters on `statusId` / `category`; `hideDone` becomes "category not in (`completed`,`canceled`)" (**D4**); the ordering `case when status = 'done' then 1 else 0 end` becomes `case when statuses.category in ('completed','canceled') then 1 else 0 end, statuses.position` | largest single file; the `completed` ⇄ `=== 'done'` swaps are all here |
| 10 | `server/utils/task-points.ts` | `taskPointColumns(weighted)` → `taskRollupColumns(weighted)`, also returning `task_count` and `completed_task_count` so the canceled rule has one definition. **`completed_points` keys off `statuses.category = 'completed'`; `points` AND `task_count` gain `and statuses.category != 'canceled'` — canceled work leaves both the numerator and the denominator.** The `tasks.id is not null` guard is unchanged and still what keeps invariant 5 true | **the invariant-5 hot spot** |
| 11 | `server/services/goals.ts` (1), `server/services/projects.ts` (2) | add `.leftJoin(statuses, eq(statuses.id, tasks.statusId))` to all four rollup queries (goal list, goal get, project list/get, milestonesFor) and take `task_count` / `completed_task_count` from `taskRollupColumns` instead of spelling `= 'done'` inline | one tasks join per query, so one statuses join suffices |
| 12 | `shared/utils/progress.ts` | `WeighedTask` gains `canceled: boolean`; canceled tasks contribute to neither total nor completed. Empty, and all-canceled, both still return `null` | the executable reference the SQL is pinned against |
| 13 | `server/services/dashboard.ts` (2) | `task.status !== 'done'` → `task.status.category` not in (`completed`,`canceled`); `completedToday` → `category === 'completed' && completedAt` today | **D3** decides whether `backlog` is excluded from Today |
| 14 | `server/services/ai.ts` (4) | context counts `open` / `overdue` / `done` become category-based via a statuses join; the `goal_plan` accept path's `status: 'todo'` becomes `statusId: undefined` (service default). **The prompt string and `goalPlanProposalSchema` stay byte-identical**, so no version bump and no evaluator pass — see **D9** |
| 15 | `server/api/statuses/*` *(new)* | `index.get.ts`, `index.post.ts`, `[id].patch.ts`, `[id].delete.ts`, `reorder.post.ts`. `requireMember` + Zod + service, `createError` for failures, PostHog flags only (`status_created`, `status_renamed`, `status_reordered`, `status_deleted` with `category`) | mirrors `server/api/labels/*`; **D7** decides member vs owner |
| 16 | `server/api/tasks/[id].patch.ts` | the PostHog branch reads the *response* row's category instead of `body.status`: completed → `task_completed`, previously completed and now not → `task_reopened` | the body no longer carries a comparable value |
| 17 | `app/composables/useStatuses.ts` *(new)* | keyed `useFetch<WorkspaceStatus[]>('/api/statuses', { key: 'workspace-statuses', default: () => [] })` plus `byCategory`, `defaultStatus`, `completedStatus`, CRUD wrappers | copy of `useLabels.ts` |
| 18 | `app/composables/useOptimisticTask.ts` + `shared/utils/task-overlay.ts` | **the status change is no longer the request body.** `patch()` keeps taking a display-shaped `Partial<Task>` (`{ status: <WorkspaceStatus> }`) for the overlay, and derives the wire body through a new pure `taskMutationBody(changes)` that maps `status` → `statusId`. Overlay semantics are untouched | without this the overlay would show a status id where a nested object belongs |
| 19 | `app/components/tasks/TaskRow.vue` | `isDone` → `current.status.category === 'completed'`; `toggle` targets the lowest-position `completed` status, or the default `unstarted` status when reopening (**D8**); `STATUS_ORDER` (hardcoded 3-value cycle) becomes the fetched status list ordered by position; the status control renders names, grouped by category | keyboard `s` still cycles |
| 20 | `app/components/tasks/Board.vue` | `columns` stop being a 3-literal array and come from `useStatuses()` ordered by position; drop sets `statusId`; empty-message text derives from the status name. **CSS currently assumes three columns** — the grid has to tolerate five | visible layout work |
| 21 | `app/components/tasks/TaskPanel.vue` | status `<select>` options from `useStatuses()`; the `status === 'done'` title class and the subtask "n of m done" count become category checks | 3 literal spots |
| 22 | `app/pages/inbox.vue`, `app/pages/projects/[id].vue` | `completedCount` / `showCompleted` filters become category checks | 1 + 2 spots |
| 23 | `app/composables/useGlobalCommands.ts` | `STATUS_LABELS` (hardcoded map) is deleted; status actions are built from `useStatuses()` — `Set status: <name>`, filtered against the focused task's current `status.id`, keywords from the name and category | the brief's "status-driven rather than enum-driven" |
| 24 | `app/pages/settings.vue` | a status editor: rename, reorder, set default, add, delete-with-replacement, read-only category badge | new section beside the estimate scale |
| 25 | `tests/workspace-fixtures.ts` | `createWorkspaceForUser` seeds the five statuses (shares `seedWorkspaceStatuses`) and returns/exposes the default status id for test task creation | **touches every existing service test**; unavoidable, since `tasks.statusId` is `NOT NULL` |

### 4.1 Where `completed` replaces `=== 'done'` (complete list)

`server/services/tasks.ts` (create completedAt, update completedAt, recurrence guard ×3, `shouldSchedule`,
`hideDone` ×3, list ordering), `server/utils/task-points.ts` (`completed_points`,
`completed_task_count`), `server/services/goals.ts` (`completed_task_count`),
`server/services/projects.ts` (×2), `server/services/dashboard.ts` (×2), `server/services/ai.ts` (×3
context counts), `server/api/tasks/[id].patch.ts` (PostHog), `app/components/tasks/TaskRow.vue`
(`isDone`, toggle, analytics), `app/components/tasks/TaskPanel.vue` (×3), `app/pages/inbox.vue`,
`app/pages/projects/[id].vue` (×2), `app/components/tasks/Board.vue` (column identity).

### 4.2 Where `canceled` must be excluded

- **Numerator and denominator both**, in `server/utils/task-points.ts`: `points`, `completed_points`,
  `task_count`, `completed_task_count`. A workspace whose only tasks are canceled must report
  `progress: null`, not 0% and not 100%.
- `shared/utils/progress.ts` — `calculateWeightedProgress` skips canceled tasks entirely, so it and
  the SQL still agree on the same fixture (`tests/estimates.test.ts` pins this).
- `listTasks` default scopes (`inbox`, `today`, `upcoming`) hide canceled alongside completed
  (**D4**), and the list ordering sorts both to the bottom.
- `server/services/dashboard.ts` — canceled is not open, not overdue, and not "completed today".
- `server/services/ai.ts` — canceled counts as neither `open` nor `done`.
- C2: rollover leaves canceled tasks in their closed cycle, and velocity never counts them.

---

## 5. C2 — exact `server/db/schema.ts` edit

### 5.1 New table, after `statuses`

```ts
export const cycles = sqliteTable('cycles', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  number: integer('number').notNull(),
  name: text('name'),
  startsAt: text('starts_at').notNull(),
  endsAt: text('ends_at').notNull(),
  cooldownDays: integer('cooldown_days').notNull().default(0),
  completedAt: text('completed_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [
  check('cycles_number_check', sql`${table.number} >= 1`),
  check('cycles_cooldown_days_check', sql`${table.cooldownDays} between 0 and 30`),
  check('cycles_range_check', sql`${table.endsAt} >= ${table.startsAt}`),
  unique('cycles_workspace_number_unique').on(table.workspaceId, table.number),
  index('idx_cycles_workspace_starts').on(table.workspaceId, table.startsAt),
  index('idx_cycles_workspace_completed').on(table.workspaceId, table.completedAt),
])
```

Two deliberate departures from the brief's column list, both to match the repository:

- `updatedAt` is added. Cycles are mutated (renamed, closed), and every other mutable table carries
  it.
- `startsAt` / `endsAt` are `YYYY-MM-DD` day strings validated by `dateSchema`, not timestamps, so
  they compare directly against `todayIso()` the way `dueDate` and `scheduledFor` already do.
  `endsAt` is the **inclusive** last day. See **D10**.

### 5.2 `workspaces` — four columns

```ts
  cycleEnabled: integer('cycle_enabled', { mode: 'boolean' }).notNull().default(false),
  cycleLengthDays: integer('cycle_length_days').notNull().default(7),
  cycleCooldownDays: integer('cycle_cooldown_days').notNull().default(0),
  futureCycleCount: integer('future_cycle_count').notNull().default(2),
```

```ts
  check('workspaces_cycle_enabled_check', sql`${table.cycleEnabled} in (0, 1)`),
  check('workspaces_cycle_length_days_check', sql`${table.cycleLengthDays} between 1 and 56`),
  check('workspaces_cycle_cooldown_days_check', sql`${table.cycleCooldownDays} between 0 and 30`),
  // Linear caps future cycles at 15; the brief says so explicitly.
  check('workspaces_future_cycle_count_check', sql`${table.futureCycleCount} between 0 and 15`),
```

### 5.3 `tasks` — one column

```ts
  cycleId: text('cycle_id').references(() => cycles.id, { onDelete: 'set null' }),
```

```ts
  index('idx_tasks_workspace_cycle').on(table.workspaceId, table.cycleId),
```

### 5.4 Registration

`cycles` is added to the exported `schema` object between `statuses` and `labelGroups`.

### 5.5 Migration `0008`

Purely additive, and expected to need **no hand-editing beyond removing the `PRAGMA foreign_keys`
statements**: `CREATE TABLE cycles` + its indexes, a rebuild of `workspaces` to attach the four new
checks (straight `INSERT ... SELECT`, all four columns defaulted), and `tasks.cycle_id`. Two points
to verify on the generated file before it is approved:

- whether drizzle-kit adds `cycle_id` with `ALTER TABLE ADD` (legal: nullable with a `NULL` default
  may carry `REFERENCES`) or rebuilds `tasks` again. Either is acceptable; a rebuild must be
  reviewed for the same row-loss risk as `0007`.
- the `workspaces` rebuild must not be allowed to cascade `workspace_members`, `tasks`, `goals`,
  `projects`, `statuses` or `labels` away — the same `DROP TABLE` hazard `0006` documented, covered
  by the row-count assertions in the replay test.

No backfill: existing tasks get `cycle_id = NULL` and cycles stay off until a workspace enables them.

### 5.6 C2 — ordered task breakdown

| # | File | Change |
|---|---|---|
| 1 | `shared/types/domain.ts` | `Cycle`, `CycleSummary` (with `progress`/`capacity`), `CycleSettings`; `Task.cycleId`; `WorkspaceSummary` gains the four cycle settings so the client can hide the UI |
| 2 | `server/db/schema.ts` | §5 | **CHECKPOINT** |
| 3 | `drizzle/0008_*.sql` | §5.5 | **CHECKPOINT** |
| 4 | `server/types/database.ts` | `CycleRow`; `TaskRow.cycle_id` |
| 5 | `shared/schemas/cycle.ts` *(new)* | `cycleSettingsSchema` (`enabled`, `lengthDays` 1-56, `cooldownDays` 0-30, `futureCycleCount` 0-15), `updateCycleSchema` (`name` nullable), `cycleQuerySchema` |
| 6 | `shared/utils/velocity.ts` *(new)* | pure: `MIN_CYCLES_FOR_VELOCITY = 3`, `calculateVelocity(completed: number[]): number \| null` (null below three), `forecastCapacity(velocity, committed)`. Mirrors the pure-data shape of `shared/utils/estimates.ts` |
| 7 | `server/services/cycles.ts` *(new)* | `enableCycles` (one transaction: current cycle + `futureCycleCount` ahead, numbers from `max(number)+1`, consecutive, cooldown applied between windows), `disableCycles` (flag only — `cycleId` values stay), `listCycles`, `activeCycle`, `nextCycle`, `closeDueCycles` (read-time, idempotent), `autoAddStartedTasks`, `setTaskCycle`, `cycleVelocity` (points when `workspaceWeighsEstimates`, counts otherwise) |
| 8 | `shared/schemas/task.ts` | query gains `cycleId: idSchema.optional()` and `cycle: z.enum(['active','none']).optional()`; update gains `cycleId: idSchema.nullable().optional()` |
| 9 | `server/services/tasks.ts` | `cycleId` in `taskSelection` / `mapTask` / filters; `assertCycle` (same workspace, else 422); auto-add to the active cycle when a task moves into a `started` category with no cycle |
| 10 | `server/services/dashboard.ts` | when `cycleEnabled`, Today's `priorities` **union** the active cycle's open tasks with the existing day-selection/date rules. `task_day_selections` composes with the weekly cycle rather than being replaced |
| 11 | `server/services/workspace.ts` + `shared/schemas/workspace.ts` | cycle settings on `updateWorkspace`; a false→true flip delegates to `enableCycles` in the same transaction |
| 12 | `server/api/cycles/index.get.ts`, `[id].patch.ts` | `requireMember`, Zod, service. Settings ride on the existing `server/api/workspace/index.patch.ts` (**D11**) |
| 13 | `app/composables/useCycles.ts`, `app/pages/cycles/index.vue`, `app/components/cycles/CapacityDial.vue` | list, active cycle, capacity dial rendering `null` as "not enough history" and never as 0 |
| 14 | `app/layouts/default.vue`, `app/pages/settings.vue` | nav entry shown only when cycles are on; cycle settings section. `/cycles` is a static route and so wins over `app/pages/[taskKey].vue`, whose `validate` rejects anything not shaped like `ACME-7` — no clash, worth a check |

**`closeDueCycles` is a write on a read path.** It must be idempotent and race-safe: the claim is
`UPDATE cycles SET completed_at = ? WHERE id = ? AND completed_at IS NULL` and the work proceeds only
when `result.changes === 1` — the same claim pattern `server/services/ai.ts` uses for proposal
acceptance. It runs inside one transaction per cycle, in `number` order, moving every task whose
status category is not `completed`/`canceled` into the next cycle (creating it, and topping the
future window back up to `futureCycleCount`, if needed). It is called from the cycles endpoints and
from `getToday`, guarded by `cycleEnabled`, and nowhere else. No scheduler, no cron (brief §6 C2).

---

## 6. Test plan

Pattern throughout: `new Database(':memory:')` → `initializeDatabase` → `createWorkspaceForUser`,
per §3 of the brief. Every new entity gets **both** isolation cases this repo now requires (the
labels review added the second): a *different workspace* case and a *second member of the same
workspace* case.

### 6.1 C1 — `tests/statuses.test.ts` (new)

| Case | Proves |
|---|---|
| a new workspace has exactly five statuses, the documented categories/positions, and exactly one `isDefault` | seeding |
| renaming `Done` to `Shipped` leaves every task's category behaviour, `completedAt` and progress unchanged | acceptance "renaming a status does not alter any task's category behaviour" |
| reorder permutes `position` only, and the list reads back in the new order | reorderable |
| a second `isDefault` write clears the first (one default, enforced by the partial index) | 2.5 |
| creating a status with a name another status in the workspace already has → 409 | `statuses_workspace_name_unique` |
| deleting a status that tasks reference without a replacement → 409; with a replacement, tasks are reassigned in one transaction and the status is gone | 2.5 + the `NO ACTION` FK backstop |
| deleting the default status without a replacement → 409 | at-least-one-default |
| `getStatus` with another workspace's id → **404**, not 403 | cross-workspace isolation |
| `updateTask` with another workspace's `statusId` → 422, and the task is unchanged | the `assertStatus` gap |
| a second member of the *same* workspace can list statuses and set a status on a project task, but still cannot touch another member's inbox task | same-workspace isolation |
| the two workspaces' seeded statuses are independent (renaming one does not touch the other) | workspace scoping |

### 6.2 C1 — `tests/tasks.test.ts` (extended)

| Case | Proves |
|---|---|
| `started → completed → started` leaves `startedAt` at its first value | acceptance "`startedAt` is stable" |
| a task created directly in a `started` status gets `startedAt`; one created in `unstarted` does not | set once, on entry |
| moving to a `completed` status sets `completedAt`; moving away clears it (recurrence exception preserved) | no regression on the existing recurrence tests |
| a canceled task disappears from `inbox` / `today` / `upcoming` and reappears with `includeCompleted` | **D4** |
| list ordering puts completed *and* canceled last, then orders by `statuses.position` | ordering swap |
| a recurring task's successor is created in the workspace's default status with `startedAt` null | §9 step 9 |
| creating a recurring task in a `completed` category → 422 from the service (the Zod branch is gone) | rule moved, not lost |
| `listTasks({ category: 'backlog' })` and `listTasks({ statusId })` each return only matching tasks | new filters |

### 6.3 C1 — progress, invariant 5

In `tests/progress.test.ts` and `tests/estimates.test.ts`:

| Case | Proves |
|---|---|
| a project with 2 open + 1 canceled task reports progress over **2**, not 3 | canceled out of the denominator |
| a project with 1 completed + 1 canceled reports 100%, not 50% | canceled out of both |
| a project whose only tasks are canceled reports `null` | invariant 5's spirit |
| an empty goal and an empty project still report `null` | **invariant 5, unchanged** |
| the SQL rollup and `calculateWeightedProgress` agree on a fixture containing canceled, unestimated and estimated tasks | the two definitions stay pinned |
| an unestimated, uncanceled collection produces the same number as before C1 | no regression |

### 6.4 C1 — migration backfill, `tests/database.test.ts`

Modelled exactly on the existing `0006` case at `tests/database.test.ts:122`: replay every `.sql`
file except `0007*` with `foreign_keys = OFF`, insert legacy fixtures, then `BEGIN` → apply
`0007` → `COMMIT`, which reproduces production's single-transaction, enforcement-off conditions.

Fixtures: two workspaces; in workspace 1 a `todo`, an `in_progress` and a `done` task with distinct
`updated_at` / `completed_at`; in workspace 2 one `todo` task; plus a `task_day_selections` row and a
`task_labels` row so cascade loss is detectable.

Assertions:

1. `count(tasks)`, `count(workspaces)`, `count(workspace_members)`, `count(task_day_selections)`,
   `count(task_labels)`, `count(users)` are all unchanged — nothing was cascaded away by `DROP TABLE`.
2. Each workspace has exactly 5 statuses, with the documented names/categories/positions, and
   exactly one `is_default = 1`.
3. Every seeded status id matches the UUID pattern `idSchema` accepts (otherwise the API could never
   select it).
4. `select count(*) from tasks where status_id is null` is 0, and every task's `status_id` resolves
   to a status **in its own workspace** with the expected category per the three-way mapping.
5. `PRAGMA table_info(tasks)` no longer lists `status`, and `tasks_status_check` is gone from
   `sqlite_master`.
6. `started_at` equals the in-progress task's `updated_at`, and is `NULL` for the done and todo tasks.
7. `PRAGMA foreign_key_check` returns no rows.
8. Re-running `initializeDatabase` is a no-op (the existing idempotence case covers the mechanism;
   assert the status count does not double).

### 6.5 C1 — schemas and access

- `tests/schemas.test.ts`: `statusId` must be a uuid; `status` is no longer accepted on create or
  update; the recurring-and-completed case is removed here and reappears in the service test.
- `tests/workspace-access.test.ts`: `/api/statuses`-level service reads return only the caller's
  workspace statuses.
- `tests/task-overlay.test.ts` (+ a small case for `taskMutationBody`): a `{ status: <object> }`
  overlay patch produces a `{ statusId }` body, and the overlay lifecycle is unchanged.

### 6.6 C2 — `tests/cycles.test.ts` and `tests/velocity.test.ts` (new)

| Case | Proves |
|---|---|
| enabling cycles creates the current cycle plus `futureCycleCount` future cycles, numbered consecutively from 1 with no gaps | acceptance "cycle numbers are consecutive per workspace with no gaps" |
| `futureCycleCount` is capped at 15 (schema check + Zod) | brief §6 C2 |
| two workspaces each start at cycle 1 | per-workspace numbering |
| closing a cycle moves `backlog`/`unstarted`/`started` tasks to the next cycle and leaves `completed` and `canceled` tasks in the closed one | acceptance "rollover moves unfinished work and leaves completed/canceled work behind" |
| `closeDueCycles` run twice in a row produces the same state and no duplicate cycles | idempotent read-time close |
| a task moved into a `started` status with no cycle joins the active cycle; one already in a cycle is not moved | auto-add |
| disabling cycles leaves every `cycleId` intact | acceptance "disabling cycles leaves `cycleId` values intact" |
| velocity with **two** completed cycles returns `null`; with three it returns their mean | acceptance "returns `null`, not a partial average" |
| velocity uses points when the workspace weighs estimates and counts when it does not | brief §6 C2 |
| a cycle id from another workspace → 404 on read, 422 on `updateTask({ cycleId })` | cross-workspace isolation |
| a second member of the same workspace sees the same cycles and can move a project task into one | same-workspace isolation |
| Today's priorities include the active cycle's open work **and** the existing day selections, with no duplicates | "composes with, and is not replaced by" |
| `tests/velocity.test.ts`: pure unit cases for `MIN_CYCLES_FOR_VELOCITY`, zero-velocity cycles, and `forecastCapacity` | pure helper |

### 6.7 C2 — migration

A `0008` replay case in `tests/database.test.ts`: all row counts preserved across the `workspaces`
rebuild, the four cycle columns present with their documented defaults, `tasks.cycle_id` null for
every pre-existing task, and `PRAGMA foreign_key_check` clean.

### 6.8 Verification

`./scripts/verify.sh` **cannot run** — Docker is unavailable on this machine. What will be run and
reported verbatim: `npx vitest run`, `npm run lint`, `npm run typecheck`, `npm run build` (all four
currently pass, 285 tests). The image build and the Docker-hosted suite will be reported as **not
run**, per §8.4 and `.agent/rules/checkpoints.md` ("never claim a check passed when it was not run").

---

## 7. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | `0007` loses task rows in the `DROP TABLE` + `INSERT ... SELECT` rebuild, silently, because enforcement is off | the `NOT NULL status_id` aborts and rolls back the whole migration on an unmapped row; §6.4 asserts row counts on `tasks`, `task_labels`, `task_day_selections`; operator backup confirmed before any non-throwaway run |
| R2 | The backfill mapping is wrong and the legacy values are gone | the mapping is reviewed at the checkpoint, exercised in §6.4 against all three legacy values, and a backup exists |
| R3 | Seeded status ids are not UUID-shaped, so backfilled statuses can never be selected through the API (`idSchema` is `uuid`) | explicit UUID construction in the seed SQL, asserted in §6.4 case 3 |
| R4 | The `Task.status` contract change breaks every client surface at once | types first (step 1) makes the compiler enumerate the work; `npm run typecheck` is the completeness check; §4 lists all 14 client spots |
| R5 | The optimistic overlay sends `{ status: <object> }` as a PATCH body and the server rejects it | `taskMutationBody` split (step 18) with its own unit case |
| R6 | A workspace ends with zero statuses, or no `completed` status, and tasks can never be finished | service invariants in 2.5 + tests in §6.1 |
| R7 | Deleting a workspace cascades `statuses` and `tasks` in an order that trips the new FK | SQLite checks immediate FKs at statement end, not per row, so cascade order is safe; nothing in the app deletes a workspace today. Covered indirectly by `PRAGMA foreign_key_check` in §6.4 |
| R8 | `closeDueCycles` writing during a GET double-closes under concurrency, or makes list reads slow | the `WHERE completed_at IS NULL` claim pattern from `server/services/ai.ts`; called from the cycles endpoints and `getToday` only, and only when `cycleEnabled` |
| R9 | `Board.vue` CSS assumes three columns and breaks at five | explicit layout work in step 20; no e2e harness, so it is reviewed and typechecked, not clicked — reported as such |
| R10 | The Today view floods with `backlog` work that used to be `todo` | **D3** must be answered before step 13 |
| R11 | `0008` regenerates a second `tasks` rebuild nobody expected | the generated file is reviewed at the C2 checkpoint before it is allowed to run |
| R12 | `tests/workspace-fixtures.ts` changing shape breaks every existing service test at once | step 25 lands with the schema change, in the same commit, and the full suite is the gate |

---

## 8. Open decisions — needed before implementation

### 8.0 Resolved at the schema checkpoint (2026-10-25)

- **Sequencing (supersedes part of D12).** `0006` had never been applied to the operator's
  database: `./data/kobi.db` was still on the pre-Slice-A schema, with 4 workspaces and 17 tasks
  (15 `todo`, 2 `done`). Writing `0007` would have meant applying two table rebuilds, four
  backfills and the `DROP` of `tasks.status` in one irreversible transaction on first boot.
  **Decision: apply `0006` alone first and confirm it migrated cleanly, then write `0007`.**
  C1 implementation is blocked until that is done.
- **D1 — API contract. Decided as recommended:** `Task.status` becomes
  `{ id, name, category, position, isDefault }`, `POST`/`PATCH /api/tasks` take `statusId`, and
  `TASK_STATUSES`/`TaskStatus` are deleted. Breaking and unversioned; acceptable because there is
  no external consumer before Slice E2.
- **D3 — `backlog` and the Today view. Decided as recommended:** excluded from Today's undated
  fallback, shown in the Inbox.
- **D7 — who may edit statuses.** Not asked, inferred from the Slice A decision that label
  deletion is owner-only: **status create, rename, reorder and delete are owner-only; every member
  may read them.** Raise it if that is wrong.
- **D12 — waves. Two waves, two checkpoints:** `0007` for C1, `0008` for C2. C1 is irreversible and
  C2 is purely additive, so merging them would mean a backup restore also discards the cycles work.

Everything below is still open.

**D1 — the `tasks.status`-shaped API contract.** The brief does not say what the wire shape becomes.
Recommended: `Task.status` becomes `{ id, name, category, position, isDefault }` and
`POST`/`PATCH /api/tasks` take `statusId`; `TASK_STATUSES` and `TaskStatus` are deleted. The
alternative — keeping a legacy `status: 'todo' | 'in_progress' | 'done'` string beside `statusId` —
is cheaper for the client but means two ways to say the same thing, and `'todo'` would no longer
name anything real. This is a **breaking, unversioned** API change; there is no external consumer
today (the MCP server is Slice E2). **Confirm.**

**D2 — `startedAt` for historically completed tasks.** Recommended: `NULL`. The alternative is
`completed_at`, which makes every pre-C1 task report a cycle time of zero in Slice D3's scatter.
Currently-in-progress tasks are stamped with their own `updated_at` either way, because they will
never transition into `started` again. **Confirm.**

**D3 — `backlog` and the Today view.** `todo` becomes `unstarted`, and `backlog` is new, so nothing
is in it after the migration — but once people use it, should backlog tasks appear in Today's
"no dates" fallback bucket and in the Inbox default list? Recommended: **excluded from Today**
(otherwise a parked backlog floods the day), **shown in the Inbox** (it is the user's own list).
This is the one place where C1 changes what an existing screen shows. **Decide.**

**D4 — what "hide completed" hides.** Recommended: the `inbox`/`today`/`upcoming` scopes hide
`completed` **and** `canceled` by default, and `includeCompleted` reveals both. The alternative is a
second flag, which the brief does not ask for. **Confirm.**

**D5 — is a status's `category` editable?** The brief says statuses are "reorderable and renameable
within a category" and that categories are not user-definable, which is ambiguous about moving an
existing status between categories. Recommended: **immutable after creation** in C1 — flipping Done
from `completed` to `started` would silently rewrite completion semantics and leave `completedAt`
inconsistent for every task holding it. **Confirm.**

**D6 — minimum workflow.** Recommended: a workspace must always keep at least one status, at least
one `completed` status, and exactly one default; `deleteStatus` requires a replacement whenever
tasks reference it or it is the default. **Confirm** (and say whether `backlog` and `canceled` are
also mandatory — recommended: no, they are optional).

**D7 — who may edit statuses?** Labels are member-writable (`requireMember`). Statuses are
workflow-level configuration, closer to workspace settings (`requireOwner`). Recommended:
`requireMember`, for consistency with labels at Kobi's scale. **Decide.**

**D8 — the row's complete/reopen toggle.** With five statuses, "toggle done" needs two targets.
Recommended: complete → the lowest-position `completed` status; reopen → the workspace default
status. The alternative is remembering the pre-completion status (needs a column, which the brief
does not grant). **Confirm.**

**D9 — Ask Kobi.** Plan: `server/services/ai.ts` changes only its *context aggregation* (the
open/overdue/done counts, now category-based) and the accept path's task insert. The prompt string
and `goalPlanProposalSchema` stay **byte-identical**, so no version constant bump and **no evaluator
pass** (`.agent/PROJECT.md` requires the bump only for a prompt change; the brief routes
status-aware proposal kinds to Slice E1). **Confirm that reading is acceptable** — if the model
should instead be told the workspace's status names, that is a prompt change and C1 gains an
evaluator step.

**D10 — cycle date granularity.** Recommended: `startsAt`/`endsAt` are `YYYY-MM-DD` day strings with
an **inclusive** `endsAt`, compared against `todayIso()`, matching `dueDate`/`scheduledFor`. The
alternative is ISO timestamps, which would need a timezone policy the app does not have. **Confirm.**

**D11 — where cycle settings live, and the velocity denominator.** (a) Recommended: the four
settings ride on `PATCH /api/workspace` (they are workspace columns), with the false→true flip
delegating to `enableCycles` inside the same transaction, rather than a separate settings endpoint.
(b) The brief says velocity is `null` below three *completed* cycles — does a cycle that closed with
zero completed work count as one of the three? Recommended: **yes**, it is real signal and lowers
the average honestly. (c) If the workspace's `estimateScale` changed mid-history, velocity uses one
mode throughout, chosen by the *current* scale (same rule as `workspaceWeighsEstimates`), rather
than mixing points and counts across cycles. **Confirm all three.**

**D12 — two migration waves, two checkpoints** (§1). **Confirm**, since it means approving `0007`
and `0008` separately.

**D13 — the backup.** `0007` must not run against the real volume until the operator confirms a
backup exists per §3.1. Until then it runs only against in-memory test databases. **Confirm the
backup, or confirm that the target database is throwaway.**

**D14 — `tests/workspace-fixtures.ts` is in scope.** `tasks.statusId` is `NOT NULL`, so the shared
fixture must seed statuses, which touches the setup of every existing service test. §8.5 of the
brief says the diff should touch only files named in the slice's spec, and this file is not named
there. **Confirm this unavoidable addition.**
