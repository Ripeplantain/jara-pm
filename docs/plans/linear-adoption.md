# Implementation prompt — adopting Linear's execution model in Kobi

You are implementing a multi-slice feature programme in the Kobi repository
(`jara-pm`). This document is the complete brief. Read it fully before touching
code, then execute one slice at a time.

---

## 0. Orientation

Kobi is a single full-stack **Nuxt 4** productivity application. Nuxt owns the Vue
UI, the Nitro API, authentication, business services, SQLite access, and the
Ask Kobi AI boundary. There is no separate backend.

```text
Goal → Project → Milestone → Task
```

Every level is optional: tasks may live in the Inbox, projects need no goal.
Primary navigation is Today, Inbox, Goals, Projects, Upcoming, Board.

**Stack:** Nuxt 4.6.2, Vue 3, TypeScript 5.9, Nitro, SQLite via `better-sqlite3`,
Drizzle ORM, `nuxt-auth-utils` sealed httpOnly sessions, Zod validation,
OpenRouter-backed AI with a local fallback planner, PostHog, Resend, Vitest,
Biome (linter only), Docker Compose, Node >= 22.

**Read these first, in order:**

1. `.agent/PROJECT.md` — project facts, commands, invariants
2. `.agent/rules/checkpoints.md` — hard stops; these override everything here
3. `.agent/rules/engineering.md` — architecture, task sizing, conventions
4. `.agent/workflows/feature.md` — the workflow you must follow
5. `AGENTS.md` and `README.md`
6. `server/db/schema.ts` — the current data model

---

## 1. The thesis

Kobi's hierarchy is **already Linear's hierarchy**:

| Linear | Kobi |
|---|---|
| Initiative | Goal |
| Project | Project |
| Milestone | Milestone |
| Issue | Task |

Nothing needs restructuring. What Kobi lacks is the **execution layer** Linear
built on that shape: cycles, labels, estimates, saved views, relations,
status categories, and a keyboard-first interaction model.

Kobi is a personal / small-team tool. Linear is team-scale. **Port Linear's
mechanics, not its organisational apparatus.** Section 9 lists what to skip and
why — do not implement those.

---

## 2. Non-negotiable constraints

These are the repository's existing invariants. Every slice must preserve all of
them. A change that breaks one is wrong even if it works.

1. **Every private read and write includes the authenticated user ID.** See
   `server/utils/auth.ts`, `server/services/tasks.ts`, `tests/tasks.test.ts`.
   New tables carry `userId` and/or `workspaceId` and are always filtered by it.
2. **Browser code never accesses SQLite, password hashes, session secrets, or AI
   provider keys.** Vue code in `app/` only calls Nitro endpoints.
3. **API input and AI provider output are both validated with Zod.** Schemas live
   in `shared/schemas/`.
4. **AI proposals remain inert until explicit acceptance, then persist in one
   transaction.** Do not weaken this; Section 7 depends on it.
5. **Empty goals and projects report `null` progress, never zero.** See
   `shared/utils/progress.ts` and `tests/progress.test.ts`. Weighted progress
   must keep this behaviour.
6. **Named-volume data is never deleted without explicit approval.** Never run
   `docker compose down -v`.

Additional hard rules from `.agent/rules/checkpoints.md`:

- **Stop and ask before any SQLite schema change.** Every migration in this
  programme is a checkpoint. State the exact schema edit and the
  `db:generate` command, and wait for a yes. A yes covers only that migration.
- **Stop and ask before** committing, pushing, opening a PR, merging, deploying,
  editing CI, or installing/removing/upgrading any dependency.
- **Never** read, print, or edit `.env` or `.env.*`. `.env.example` is safe to update.
- **Never** add attribution trailers (`Co-Authored-By`, `Generated with`).
- **Never** create parallel copies (`*-v2`, `*-new`, `copy of`).
- **Never** claim a check passed when it was not run.

---

## 3. Patterns to follow exactly

New code goes beside equivalent existing code. These are the established shapes.

### API handler — `server/api/tasks/index.post.ts`

```ts
export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireMember(event)
  const body = await readValidatedBody(event, createTaskSchema.parse)
  const task = createTask(useDatabase(event), user.id, workspaceId, body)
  captureServerEvent(event, user.id, 'task_created', { /* flags, never content */ })
  setResponseStatus(event, 201)
  return task
})
```

- Auth helpers: `requireUser`, `requireMember`, `requireOwner`,
  `requireWorkspaceMember`, `requireWorkspaceOwner` in `server/utils/auth.ts`.
- Use `createError` for HTTP failures. Use `useRuntimeConfig(event)` for server config.
- PostHog events carry booleans and enums only — never titles or descriptions.

### Service — `server/services/tasks.ts`

Signature is `(db: KobiDb, userId: string, workspaceId: string, input)`.
Services own business rules, SQLite writes, and transactions. Multi-row writes
run inside a single Drizzle transaction.

### Schema — `server/db/schema.ts`

- `text('id').primaryKey()` holding a UUID.
- Timestamps are ISO strings in `text` columns, not integers.
- Enums use `.$type<'a' | 'b'>()` **and** a `check()` constraint. Mirror the
  values in `shared/types/domain.ts` as an `as const` array with a derived type.
- Index every column combination you filter on, prefixed by `workspaceId`
  (follow `idx_tasks_workspace_status`).
- Register every new table in the exported `schema` object at the bottom.

### Migrations

1. Edit `server/db/schema.ts`.
2. **Checkpoint — ask first.**
3. `docker compose run --rm --no-deps app npm run db:generate`
4. Commit the generated file in `drizzle/` (next number is `0006`).

`migrate()` in `server/utils/database.ts` applies migrations when Nitro first
opens the database. Do not hand-write migration SQL unless a data backfill
requires it; if it does, say so at the checkpoint.

### Validation — `shared/schemas/`

Reuse the primitives in `shared/schemas/common.ts`: `idSchema` (uuid),
`dateSchema` (`YYYY-MM-DD`, nullable, calendar-validated), `titleSchema`
(trimmed, 1–200), `descriptionSchema` (trimmed, max 10 000). Query flags use
`queryFlagSchema` from `shared/schemas/query.ts` — do not reach for
`z.coerce.boolean()`, the comment there explains why.

### Tests — `tests/`

```ts
sqlite = new Database(':memory:')
db = initializeDatabase(sqlite)
const workspaceId = createWorkspaceForUser(db, userId)
```

Reuse `tests/workspace-fixtures.ts`. Service-level tests are the norm; there is
no e2e harness. Every slice must include a test that a second user in a second
workspace cannot read or mutate the new entity.

### Vue — `app/`

`<script setup lang="ts">`, strict TypeScript, keyed `useFetch` / `useAsyncData`
with an explicit `default`. Components are grouped by domain under
`app/components/`. Composables live in `app/composables/`. Biome lints only the
`<script>` block of `.vue` files; templates and styles are not linted.

### Verification

| Purpose | Command |
|---|---|
| dev | `docker compose up --build` (port 3000) |
| lint | `docker compose run --rm --no-deps app npm run lint` |
| typecheck | `docker compose run --rm --no-deps app npm run typecheck` |
| test | `docker compose run --rm --no-deps app npm test` |
| build | `docker compose run --rm --no-deps app npm run build` |
| full gate | `./scripts/verify.sh` |
| fast gate | `./scripts/pre-push.sh` |

Run `./scripts/verify.sh` before reporting a slice complete. If Docker is
unavailable, report it as **not run** — do not imply it passed.

### Workflow and sizing

Follow `.agent/workflows/feature.md`: planner → implementer → tester → reviewer,
then stop at the commit checkpoint. AI changes insert **evaluator** before review.
Sizing from `.agent/rules/engineering.md`: L0–L1 change/check/self-review; L2
brief plan, tests, separate review; **L3–L4 written plan, checkpoint approval,
independent review**. Every schema slice here is L3.

Branches: `feat/<short-slug>`. Commits: `feat(scope): lowercase claim`.

---

## 4. "The Linear way" — design constraints for every slice

These are not features. They are how the features must behave.

1. **Opinionated defaults over configurability.** Linear beat Jira by removing
   choices. Kobi's fixed four-level hierarchy is a feature — do not make
   everything user-definable.
2. **Keyboard-first, every action.** Single-key shortcuts on the focused or
   hovered row: `a` assign, `p` priority, `l` label, `s` status, `d` due date,
   `e` estimate. Not palette-only.
3. **Optimistic updates, always.** Mutate local state, fire the request, roll
   back and toast on failure. `replaceTask` in `app/pages/board.vue` is the right
   shape — generalise it rather than repeating it.
4. **Side panels, not modals.** Never block the view. A task opens beside the
   list, the URL updates, the list stays interactive.
5. **Automate the date math.** Cycles roll over on their own. Unfinished work
   moves forward without asking. Never make the user compute a boundary.
6. **Honest empty and unmeasured states.** `null` progress for unmeasured, not
   zero. Kobi already does this; keep it everywhere.
7. **Every list is a view; every view is a URL.** Filters serialise to the query
   string so any state is shareable and bookmarkable.
8. **Speed is the feature.** SQLite on one box is an advantage. Keep payloads
   lean and transitions instant.

---

## 5. Slice plan

Execute in this order. Each slice is independently shippable and ends at the
commit checkpoint. **Slice B has no migrations and may be pulled forward if you
want visible progress before the first schema checkpoint.**

| Slice | Contents | Size | Migration? |
|---|---|---|---|
| A — Foundation | Labels, Estimates, Identifiers | L3 | Yes (one wave) |
| B — Feel | Command palette, optimistic updates, side-panel detail | L1–L2 | No |
| C — Rhythm | Status categories, Cycles | L3 | Yes |
| D — Leverage | Relations, Comments + activity, Insights | L3 | Yes |
| E — Intelligence | New AI proposal kinds, MCP server | L3 | Minor |

Group Slice A's three schema changes into **one migration wave and one
checkpoint**, not three.

---

## 6. Slice specifications

### Slice A1 — Labels `L3`

The most-used Linear feature Kobi lacks, and a prerequisite for views, insights,
and triage. Copy Linear's **label group** behaviour: labels inside a group are
mutually exclusive (so `Type: bug | feature | chore` is single-select), while
ungrouped labels are multi-select.

**Schema**

```text
label_groups  id, workspaceId, name, position, createdAt
labels        id, workspaceId, groupId (nullable), name, color, description,
              archivedAt (nullable), createdAt, updatedAt
task_labels   taskId, labelId  -- unique(taskId, labelId)
```

Indexes: `(workspaceId, name)` unique on `labels`; `(labelId)` on `task_labels`.

**Behaviour**

- Workspace-scoped, not user-scoped — labels are shared within a workspace.
- Applying a grouped label replaces any existing label from the same group, in
  one transaction.
- Archived labels stay attached to historical tasks but are hidden from pickers.
- `listTasks` accepts `labelIds` and filters with AND semantics across groups.

**Files:** `server/db/schema.ts`, `server/services/labels.ts` (new),
`server/api/labels/*`, `shared/schemas/label.ts` (new), `shared/types/domain.ts`,
`server/services/tasks.ts` (filter + hydration), `app/components/tasks/TaskRow.vue`,
a new `app/components/labels/LabelPicker.vue`, `tests/labels.test.ts` (new).

**Acceptance**

- A grouped label swap leaves exactly one label from that group attached.
- Filtering by two labels returns only tasks carrying both.
- A member of another workspace receives 404 for a label ID they do not own.
- Deleting a task removes its `task_labels` rows (FK cascade).

---

### Slice A2 — Estimates and weighted progress `L3`

Progress is currently computed from task counts, which lies when task sizes
differ. Linear computes from effort points.

**Schema**

```text
tasks.estimate         integer, nullable
workspaces.estimateScale  text, default 'none'
                       check in ('none','exponential','fibonacci','linear','tshirt')
```

**Behaviour**

- Scale definitions live in `shared/utils/estimates.ts` (new) as pure data:
  exponential `1,2,4,8,16`, fibonacci `1,2,3,5,8,13,21`, linear `1..7`,
  t-shirt `XS..XXXL` mapped to points.
- `shared/utils/progress.ts` gains a weighted mode: when **any** task in the
  collection has an estimate, sum points and treat unestimated tasks as 1 point;
  otherwise fall back to counts.
- **Invariant 5 holds**: an empty collection still returns `null`, never `0`.
- `scale === 'none'` hides the estimate field in the UI entirely.

**Files:** `server/db/schema.ts`, `shared/utils/estimates.ts` (new),
`shared/utils/progress.ts`, `shared/schemas/task.ts`, `shared/schemas/workspace.ts`,
`server/services/tasks.ts`, `server/services/projects.ts`, `server/services/goals.ts`,
`app/pages/settings.vue`, `tests/progress.test.ts`, `tests/estimates.test.ts` (new).

**Acceptance**

- Mixed estimated/unestimated collection weights correctly with 1-point defaults.
- Fully unestimated collection produces the same number as today (no regression).
- Empty goal and empty project both still report `null`.
- Changing the workspace scale does not rewrite stored estimates.

---

### Slice A3 — Task identifiers `L3`

`K-128` instead of a UUID. Not cosmetic — it is what makes a task referenceable
in a commit message, a Slack thread, or a sentence.

**Schema**

```text
workspaces.key          text, 1-5 uppercase chars, unique
workspaces.taskCounter  integer, not null, default 0
tasks.number            integer, not null  -- unique(workspaceId, number)
```

**Behaviour**

- The counter increments and the task inserts **inside the same transaction**.
  Concurrent creates must never collide — assert this with a test that creates
  tasks in a tight loop.
- `workspaces.key` is derived from the workspace name on creation
  (uppercase initials, collision-suffixed) and is editable in settings.
- Display format `${key}-${number}`. Add `GET /api/tasks/by-key/:key` resolution
  and make `/K-128` a valid route that opens the task.
- Backfill existing rows in migration order by `createdAt` so numbering is stable.
- Autolink `K-\d+` in descriptions and comments.

**Files:** `server/db/schema.ts`, hand-written backfill in the generated
migration, `server/services/tasks.ts`, `server/services/workspace.ts`,
`shared/utils/task-key.ts` (new), `app/pages/settings.vue`,
`app/components/tasks/TaskRow.vue`, `tests/task-key.test.ts` (new).

**Acceptance**

- 50 tasks created in a loop get 50 distinct consecutive numbers.
- Numbers are per-workspace: two workspaces both start at 1.
- Backfill assigns every pre-existing task a number with no gaps or duplicates.
- An unknown key returns 404, not a 500.

---

### Slice B1 — Command palette `L2`

`Cmd/Ctrl+K`. This is what people mean when they say "it feels like Linear."
No schema. Highest perceived quality per hour in the programme.

**Behaviour**

- An action registry: `{ id, label, group, icon, keywords, when, run }`.
  Pages register contextual actions; global actions are always present.
- Actions: create task, create project, create goal, go to Today / Inbox /
  Upcoming / Board / Goals / Projects / Settings, jump to any project or goal by
  name, jump to a task by key, switch workspace, toggle theme, open Ask Kobi,
  and — when a task is focused — set status / priority / assignee / due date /
  estimate / labels on it.
- Fuzzy match over label plus keywords. Arrow keys and Enter. Esc closes.
- Fully accessible: `role="dialog"`, focus trap, `aria-activedescendant`,
  restore focus on close.

**Files:** `app/composables/useCommandPalette.ts` (new),
`app/components/common/CommandPalette.vue` (new), registration in the default
layout, per-page `registerActions` calls.

**Acceptance**

- `Cmd+K` opens from every authenticated page and never from auth pages.
- Typing a project name and pressing Enter navigates to it.
- Creating a task from the palette lands it in the Inbox and refreshes the list.
- No action fires twice on double Enter.

---

### Slice B2 — Optimistic updates `L1`

Generalise `replaceTask` from `app/pages/board.vue:14` into a reusable
composable so every mutation feels instant.

**Behaviour**

- `useOptimisticTask()` exposes `patch(taskId, changes)`: apply to local state,
  PATCH, reconcile with the server row, and on failure restore the snapshot and
  raise a toast via `useToasts`.
- Adopt it in `TaskRow.vue`, `TaskList.vue`, `Board.vue`, Today, Inbox, Upcoming.
- Recurrence and `selectedForToday` already have server-side side effects —
  always reconcile with the returned row rather than trusting the local guess.

**Acceptance**

- Status change renders before the network settles.
- A forced 500 restores the previous value and shows one toast.
- No duplicated or lost rows after rapid consecutive changes to the same task.

---

### Slice B3 — Side-panel task detail `L2`

Replace any blocking interaction with a panel beside the list.

**Behaviour**

- Route-driven: `?task=K-128` on any list page, deep-linkable, Esc closes and
  restores the query string.
- Panel shows title, description, status, priority, assignee, dates, estimate,
  labels, parent/subtasks, and (after Slice D) relations, comments, activity.
- The list stays scrollable and interactive while the panel is open.
- On mobile the panel becomes a full-height sheet; reuse `MobileNav.vue` patterns.

**Acceptance**

- Opening and closing the panel never remounts or refetches the list.
- A pasted `?task=` URL opens the panel on first load.
- Browser back closes the panel rather than leaving the page.

---

### Slice C1 — Status categories and custom workflow `L3`

`tasks.status` is a fixed three-value enum. Linear separates the **category**
(which automation reasons about) from the user's **named status** (which teams
rename freely). Kobi genuinely needs the two missing categories: backlog and
canceled.

**Schema**

```text
statuses        id, workspaceId, name, category, position, isDefault, createdAt
                category check in ('backlog','unstarted','started','completed','canceled')
tasks.statusId  text, not null, FK statuses.id
tasks.startedAt text, nullable   -- first transition into a 'started' status
```

**Behaviour**

- Seed every existing workspace with: Backlog (`backlog`), Todo (`unstarted`,
  default), In Progress (`started`), Done (`completed`), Canceled (`canceled`).
- Backfill `tasks.statusId`: `todo → Todo`, `in_progress → In Progress`,
  `done → Done`. Then drop the legacy `status` column and its check constraint
  in the same migration.
- `startedAt` is set once, on the first move into a `started` category, and never
  cleared by later transitions. `completedAt` keeps its current behaviour.
- Completion checks everywhere become "category is `completed`", and progress
  excludes `canceled` tasks from both numerator and denominator.
- Statuses are reorderable and renameable within a category; categories are not
  user-definable. At least one status per workspace must be `isDefault`.

**This is the riskiest migration in the programme.** Present the full backfill
SQL at the checkpoint, state that it is irreversible, and confirm the operator
has backed up the volume before it runs on anything but a throwaway database.

**Acceptance**

- Every pre-existing task ends with a correct `statusId` and no nulls.
- A canceled task is excluded from progress denominators.
- `startedAt` is stable across `started → completed → started` transitions.
- Renaming a status does not alter any task's category behaviour.

---

### Slice C2 — Cycles `L3`

Kobi's weekly cadence layer. **Scope cycles to the workspace** — do not introduce
a Teams layer (see Section 9).

**Schema**

```text
cycles        id, workspaceId, number, name (nullable), startsAt, endsAt,
              cooldownDays, completedAt (nullable), createdAt
tasks.cycleId text, nullable, FK cycles.id on delete set null
workspaces.cycleEnabled        integer (bool), default 0
workspaces.cycleLengthDays     integer, default 7
workspaces.cycleCooldownDays   integer, default 0
workspaces.futureCycleCount    integer, default 2   -- max 15
```

**Behaviour — copy Linear's details exactly**

- Enabling cycles auto-creates the current cycle plus `futureCycleCount` future
  cycles. Capped at 15, as Linear caps it.
- **Rollover:** closing a cycle moves every task not in a `completed` or
  `canceled` category into the next cycle. Completed and canceled tasks stay put
  so history is preserved.
- **Auto-add:** tasks in a `started` category with no cycle join the active cycle.
- **Capacity dial:** for a not-yet-started cycle, predict completion from the
  trailing three completed cycles' velocity — points when estimates exist,
  counts otherwise. With fewer than three completed cycles, return `null`
  (unmeasured) rather than a guess. Invariant 5's spirit applies.
- Cycle close is time-driven, computed server-side from `endsAt` on read. Do not
  add a scheduler or cron in this slice.
- The Today view's "priorities" draw from the active cycle when cycles are on.
  Kobi's `task_day_selections` daily rhythm composes with, and is not replaced
  by, the weekly cycle.

**Files:** `server/db/schema.ts`, `server/services/cycles.ts` (new),
`server/api/cycles/*`, `shared/schemas/cycle.ts` (new),
`shared/utils/velocity.ts` (new), `server/services/dashboard.ts`,
`app/pages/cycles/index.vue` (new), `app/components/cycles/CapacityDial.vue` (new),
`tests/cycles.test.ts` (new), `tests/velocity.test.ts` (new).

**Acceptance**

- Rollover moves unfinished work and leaves completed/canceled work behind.
- Velocity with two completed cycles returns `null`, not a partial average.
- Disabling cycles leaves `cycleId` values intact and simply hides the UI.
- Cycle numbers are consecutive per workspace with no gaps.

---

### Slice D1 — Task relations `L3`

`parent_id` gives hierarchy; nothing gives lateral links.

**Schema**

```text
task_relations  id, workspaceId, fromTaskId, toTaskId, type, createdAt
                type check in ('related','blocks','duplicate')
                unique(fromTaskId, toTaskId, type)
```

**Behaviour**

- Store one canonical direction. `blocked_by` is the inverse read of `blocks` —
  do not store both rows.
- `related` and `duplicate` are symmetric on read; `blocks` is directional.
- Copy Linear's touch: **@-mentioning a task key in a description or comment
  auto-creates a `related` link.**
- A `blocks` relation whose blocker reaches a `completed` category is presented
  as resolved rather than deleted.
- Reject self-relations and cross-workspace relations with 400 and 404 respectively.

**Acceptance**

- Creating `A blocks B` makes B show "blocked by A" without a second row.
- A description mentioning `K-12` produces exactly one `related` row, and editing
  the description again does not duplicate it.
- Deleting a task removes its relations.

---

### Slice D2 — Comments and activity `L3`

A task is currently a static record. Linear's issue page is a timeline. This
becomes table stakes the moment a second person joins — and the invite system
already exists, so that moment is coming.

**Schema**

```text
comments         id, workspaceId, taskId, userId, body, createdAt, updatedAt,
                 deletedAt (nullable)
activity_events  id, workspaceId, entityType, entityId, userId, action,
                 fromValue (nullable), toValue (nullable), createdAt
```

**Behaviour**

- Activity is written **from the service layer** on every mutation, in the same
  transaction as the change. Never from a handler, or it will be missed.
- `entityType` covers task, project, milestone, goal.
- Comments are soft-deleted: body cleared, row retained for thread continuity.
- Only the author may edit or delete their comment; any workspace member may read.
- The task panel renders comments and activity in one merged chronological feed.
- Cap stored `fromValue`/`toValue` length; never log descriptions verbatim.

**Acceptance**

- A status change produces exactly one activity row with correct from/to.
- A failed mutation writes no activity row (transaction holds).
- Another member can read but not edit a comment.

---

### Slice D3 — Insights `L2`

Cheap, because it is read-only aggregation over data the earlier slices create.
Note that **lead time works today with zero schema change** — `createdAt` and
`completedAt` already exist.

**Behaviour**

Six measures, matching Linear's:

| Measure | Source | Shape |
|---|---|---|
| Task count | row count | bar |
| Effort | sum of estimates (Slice A2) | bar |
| Cycle time | `startedAt → completedAt` (Slice C1) | scatter |
| Lead time | `createdAt → completedAt` | scatter |
| Age | `createdAt → now`, open tasks | scatter |
| Triage time | `createdAt → first project assignment` | scatter |

- One required `slice` dimension (assignee, status, project, goal, label,
  priority, cycle) and one optional `segment` dimension.
- Single endpoint `server/api/insights.get.ts`, Zod-validated query, aggregation
  in SQL not JavaScript.
- Scatter responses include p50/p90 markers.
- Rendered in a right sidebar, opened with `Cmd/Ctrl+Shift+I`, as in Linear.
- Fewer than 3 data points returns `null` percentiles rather than a misleading one.

**Acceptance**

- Every measure × slice combination returns without error on an empty workspace.
- Aggregates respect the caller's workspace scope — verify with a two-workspace test.
- Percentiles match a hand-computed fixture.

---

### Slice E1 — More AI proposal kinds `L3` + evaluator

**Kobi already implements Linear Agent's contract and this is the highest-leverage
work in the programme.** Invariant 4 — proposals inert until explicit acceptance,
then transactional — is exactly how Linear Agent operates. `ai_proposals` with
`pending/accepted/rejected` is the right table. The only limitation is that
`kind` never holds anything but `'goal_plan'`.

**No new infrastructure. Same transaction semantics. Same editable preview UI.**

| New `kind` | Proposes | Linear equivalent |
|---|---|---|
| `triage` | Labels, priority, project, estimate for a new Inbox task | Triage Intelligence |
| `reschedule` | A new plan for overdue work, rendered as a diff | — (Kobi-native) |
| `cycle_plan` | Which tasks to pull into the next cycle, against capacity | Cycle planning |
| `project_update` | A drafted status update from the week's activity | Agent-assisted project updates |
| `breakdown` | Milestones and tasks for one existing project | Issue decomposition |

`reschedule` is where Kobi beats Linear, because Linear has no concept of a
personal day. Treat it as the differentiator, not a copy.

**Implementation**

- In `shared/schemas/ai.ts`: keep `goalPlanProposalSchema` **byte-identical** and
  add `proposalSchema = z.discriminatedUnion('kind', [...])`. Give each kind its
  own bounds constant alongside `PLAN_BOUNDS`.
- Mirror each new kind in the provider JSON schema (`aiReplyJsonSchema`) so the
  model is constrained before Zod applies business bounds.
- `server/api/ai/proposals/[id]/accept.post.ts` dispatches on `kind`; each
  handler persists in one transaction.
- `server/services/ai.ts`: the prompt is inline and **a prompt change must add or
  update a version constant before evaluation** (`.agent/PROJECT.md`, Section
  "Specs"). Bump it.
- Preserve the `AiReplySource` contract — `'offline'` and `'invalid'` must stay
  visible to the client. A fallback that looks like a model reply hides outages.
- Follow `.agent/workflows/prompt-change.md` and `.agent/rules/evals.md`: run
  **evaluator** before reviewer. Add eval cases per kind under `evals/`.
- **Checkpoint:** more than 50 paid provider calls in one command needs approval.

**Acceptance**

- An existing `goal_plan` proposal still accepts unchanged (regression test).
- Each new kind round-trips: propose → edit → accept → correct rows, one transaction.
- A malformed model reply for any kind yields `source: 'invalid'` and persists nothing.
- A rejected proposal leaves the database untouched.

---

### Slice E2 — MCP server `L3`

Linear's AI-clients integration is their API behind MCP. Kobi has a clean
Zod-validated Nitro API, so a thin MCP layer makes it drivable from Claude Code —
real distribution for a dev-facing tool.

**Behaviour**

- Tools: list/create/update tasks, list projects and goals, list cycles, read
  insights, and **create** (never auto-accept) AI proposals.
- Authentication by scoped API token, not session cookie. New `api_tokens` table:
  hashed token, name, `lastUsedAt`, `revokedAt`. Reuse the hashing approach from
  `workspace_invites.tokenHash`.
- Reuse the existing Zod schemas as the tool input schemas — one source of truth.
- Every tool call is workspace-scoped by the token. Invariant 1 applies.
- Adding an MCP SDK dependency is a **checkpoint**.

**Acceptance**

- A revoked token is rejected on the next call.
- No tool can read or write across workspaces.
- Proposal-creating tools leave `status: 'pending'`.

---

## 7. Cross-cutting work

Fold these into the slice that first needs them rather than doing them separately.

- **Filter schema.** Slice A1 forces `collectionQuerySchema` in
  `shared/schemas/query.ts` to grow into a real `taskFilterSchema` (status,
  category, priority, labels, assignee, project, goal, cycle, estimate range,
  date ranges, text). Make it the single source of truth shared by `listTasks`,
  saved views, Insights, and the URL serialiser.
- **Saved views `L2`.** Once `taskFilterSchema` exists, add
  `saved_views (id, workspaceId, userId, name, icon, filterJson, grouping,
  ordering, isShared, position, timestamps)` and a sidebar Views section.
  `useTaskViews.ts` and `useListPreferences.ts` already point this direction —
  formalise them, do not duplicate them. Deliver with Slice D.
- **URL serialisation.** Principle 7 from Section 4: every filter must round-trip
  through the query string.
- **PostHog.** Add events for each new capability via
  `server/utils/posthog.ts` / `useProductAnalytics.ts`. Flags and enums only.

---

## 8. Definition of done, per slice

From `.agent/workflows/feature.md`:

> Done means the requested behavior works, tests and `./scripts/verify.sh` pass
> when runnable, the diff is scoped, no secrets were added, and every unverified
> check is reported.

Concretely, before reporting a slice complete:

1. All acceptance criteria for the slice demonstrably pass.
2. New Vitest coverage exists, including the cross-workspace isolation test.
3. All six invariants in Section 2 still hold — state this explicitly per invariant.
4. `./scripts/verify.sh` was run, with exact output reported; or it was not
   runnable, and you say so plainly.
5. The diff touches only files named in that slice's spec.
6. Reviewer role completed (plus evaluator for Slice E1).
7. You **stop at the commit checkpoint** and do not commit, push, or open a PR.

---

## 9. Explicitly out of scope

Do not implement these. Each was considered and rejected for a stated reason.

| Linear feature | Why not |
|---|---|
| Teams layer | The workspace already serves this role. Teams would double scoping complexity on every query for no gain at Kobi's scale. **Cycles and statuses are workspace-scoped because of this decision.** |
| SLAs | Enterprise support-desk concern. Kobi has due dates. |
| Linear Asks (email / form intake) | Requires an organisation of non-users submitting requests. Kobi has no such audience. |
| Customer Requests, revenue attributes, customer records | B2B product-management feature set. Wrong product. |
| Triage as a separate inbox | Kobi **has** an Inbox. Add triage *intelligence* to it (Slice E1) rather than a second queue. |
| Initiatives above Goals | Goal is already the top level. Four levels is enough; five is Jira. |
| Rich-text / block editor, documents, user-defined properties | A different product direction (Notion-shaped). Out of scope for this programme — raise it as a separate decision if wanted. |

---

## 10. First action

Do not start coding. Start by:

1. Reading the six documents in Section 0.
2. Confirming the current migration number in `drizzle/` (expected: `0005`, so
   the next is `0006`).
3. Spawning **planner** for Slice A and producing a written plan — Slice A is L3
   and crosses the schema checkpoint.
4. Presenting that plan, the exact `server/db/schema.ts` edit, and the
   `db:generate` command for approval.

Then wait.

---

## 11. Implementation checklist

Use this checklist as the execution record. Complete one slice at a time, keep
the diff scoped to that slice, and stop at each checkpoint until approval is
given.

### Before implementation

- [x] Read `.agent/PROJECT.md`.
- [x] Read `.agent/rules/checkpoints.md` and `.agent/rules/engineering.md`.
- [ ] Read `.agent/workflows/feature.md`, `AGENTS.md`, and `README.md`.
- [x] Read `server/db/schema.ts` and inspect the current task, workspace, and
      migration patterns.
- [x] Confirm the latest migration is `drizzle/0005_*.sql`; reserve `0006` as
      the next migration number. Landed as `drizzle/0006_past_rick_jones.sql`.
- [x] Confirm the working tree and identify unrelated changes before starting.
- [ ] Spawn the planner for Slice A and write the Slice A implementation plan.
- [ ] Present the schema edit and exact migration command for approval before
      changing the database schema.

### Slice A — Foundation

#### A1 — Labels

- [x] Add label groups, labels, and task-label schema and indexes.
- [x] Add validated label schemas, domain types, service methods, and API
      handlers.
- [x] Enforce workspace scope, grouped-label replacement, archived-label
      picker behavior, and AND filtering.
- [x] Hydrate labels in task responses and add the label picker to task rows.
- [x] Add isolation, grouped replacement, filtering, and foreign-key cascade
      tests. Review added the missing *same-workspace second member* case.
- [x] Obtain schema checkpoint approval, run `npm run db:generate`, and review
      the generated migration.
- [x] Run the tester and reviewer roles. Reviewer found one blocking defect
      (label writes were not user-scoped) and one correctness defect
      (regrouping left two siblings of a group on a task); both fixed, each
      covered by a test confirmed to fail without the fix.
- [ ] Run `./scripts/verify.sh`; record the exact result. **Not run** — Docker
      is unavailable on this machine. Lint, typecheck and 239 Vitest tests were
      run locally and pass; the image and production builds were not run.
- [ ] Stop at the commit checkpoint. **Stopped here, awaiting approval.**

#### A2 — Estimates and weighted progress

- [x] Add nullable task estimates and the workspace estimate scale.
- [x] Add estimate scale definitions and validation for supported values.
- [x] Implement weighted progress with one-point defaults for unestimated
      tasks and preserve `null` for empty collections.
- [x] Update task, project, goal, workspace-settings, and progress behavior.
- [x] Add regression and weighted-progress tests, including unchanged stored
      estimates when the workspace scale changes. Coverage landed in
      `tests/estimates.test.ts`; `tests/progress.test.ts` is unchanged.
- [x] Obtain schema checkpoint approval, generate, and review the migration.
- [x] Run the tester and reviewer roles. Two open items left for decision:
      a workspace switched back to `none` keeps weighting progress by stored
      estimates while hiding the field, and `calculateWeightedProgress` has no
      production caller because the rollups repeat the rule in SQL.
- [ ] Run `./scripts/verify.sh`; record the exact result. **Not run** — Docker
      unavailable.
- [ ] Stop at the commit checkpoint. **Stopped here, awaiting approval.**

#### A3 — Task identifiers

- [x] Add workspace keys, task counters, and per-workspace task numbers.
- [x] Design and review the transactional counter increment and existing-task
      backfill before editing the migration.
- [x] Obtain schema checkpoint approval, including the backfill SQL and
      `npm run db:generate` command.
- [x] Implement stable `KEY-number` display and key-based task resolution.
- [x] Add description/comment autolinking without duplicating references.
      Task descriptions only; goal and project descriptions are not autolinked.
- [x] Test concurrent-style creation, per-workspace numbering, backfill
      completeness, unknown-key `404`, and workspace isolation. The 50-task
      loop cannot truly interleave under better-sqlite3's single synchronous
      connection; no-collision rests on the atomic `UPDATE ... RETURNING`.
- [x] Run the tester and reviewer roles. Open item: the backfill's correlated
      `count(*)` is quadratic (measured 7.4 s at 10 000 tasks, 29.8 s at
      20 000) and runs inside the first database open.
- [ ] Run `./scripts/verify.sh`; record the exact result. **Not run** — Docker
      unavailable.
- [ ] Stop at the commit checkpoint. **Stopped here, awaiting approval.**

### Slice B — Feel

#### B1 — Command palette

- [x] Add the action registry and command-palette composable/component.
      `useCommandPalette` owns the registry and the Cmd/Ctrl+K binding;
      `useGlobalCommands` builds the action set.
- [x] Register global and page-specific actions, including task-focused
      actions. Task actions key off `useFocusedTask`, set by a row on hover or
      keyboard focus and by the panel when it opens. No page registers its own
      actions yet -- the hook (`registerActions(owner, actions)`) exists and the
      global set is registered through it.
- [x] Implement keyboard navigation, fuzzy matching, focus trapping, and
      focus restoration. Ranking is pure and unit-tested in
      `tests/command-score.test.ts`.
- [x] Verify authenticated-page access, project/task navigation, task creation,
      and double-Enter protection. Access is structural: the binding lives in
      the `default` layout, which the auth pages do not use. Double-Enter is
      guarded by `isRunning`. **Not exercised in a browser** -- there is no e2e
      harness and Docker is unavailable, so the keyboard and focus behaviour was
      reviewed and type-checked, not clicked.
- [x] Run focused checks and the reviewer role.
- [ ] Run `./scripts/verify.sh`; record the exact result. **Not run** -- Docker
      unavailable. Lint, typecheck, 279 Vitest tests and `npm run build` all
      pass locally.
- [ ] Stop at the commit checkpoint. **Stopped here, awaiting approval.**

#### B2 — Optimistic updates

- [x] Extract the board mutation pattern into `useOptimisticTask()`. The change
      is recorded once in a shared overlay rather than spliced into one page's
      array, so a task rendered on several surfaces updates on all of them.
- [x] Adopt it across task list, board, Today, Inbox, and Upcoming surfaces.
      The three list pages no longer refetch on every edit; `projects/[id].vue`
      keeps its handler because its own cache key is not one `refreshTaskViews`
      refreshes.
- [x] Reconcile with server-returned rows for recurrence and daily-selection
      side effects. The response row is adopted wholesale, never the local guess.
- [x] Verify rollback, one-toast failure handling, and rapid consecutive
      mutations. Review found two blocking defects here, both fixed:
      the settle check compared the server row against itself so it always
      passed, clearing the overlay even for surfaces `refreshTaskViews` does not
      refresh (the panel visibly reverted an accepted edit); and the failure path
      could leave a rejected value pinned on screen for the life of the document.
      The lifecycle is now an explicit state machine in
      `shared/utils/task-overlay.ts` -- every path either clears the task's entry
      or hands it to a newer mutation -- with 21 cases in
      `tests/task-overlay.test.ts` covering concurrent failures, stale responses
      and success-then-failure. Surfaces with their own cache key register a
      refresh through `useTaskViews.registerTaskView`.
- [x] Run focused checks and the reviewer role.
- [ ] Run `./scripts/verify.sh`; record the exact result. **Not run** -- Docker
      unavailable.
- [ ] Stop at the commit checkpoint. **Stopped here, awaiting approval.**

#### B3 — Side-panel task detail

- [x] Add route-driven task-panel state using `?task=KEY-number`. A malformed
      key is treated as no panel rather than a lookup that will 404.
- [x] Keep list state interactive without remounting or refetching it. The panel
      is rendered by the layout, so only the query string changes: page
      components stay mounted and their `useFetch` keys are static. The panel is
      deliberately not a modal -- no `aria-modal`, no overlay, no focus trap.
- [x] Implement desktop side panel, mobile sheet behavior, Esc close, and
      browser-back behavior. Below 620px the sheet covers the screen, so there
      it becomes a real dialog -- `role="dialog"`, `aria-modal`, a Tab trap and
      `inert` on everything behind it -- while staying a non-blocking side panel
      above that width. The breakpoint is shared with the CSS rule that makes it
      full width, since the two have to agree. Opening pushes a history entry so Back closes the
      panel; a panel arriving in a pasted URL is closed by replacing instead,
      which would otherwise leave the app.
- [x] Verify deep links and panel content for all currently available task
      fields. Subtasks needed a `parentId` read filter on `listTasks`, added with
      tests including a cross-member isolation case. **Browser behaviour not
      exercised** -- no e2e harness.
- [x] Run focused checks and the reviewer role.
- [ ] Run `./scripts/verify.sh`; record the exact result. **Not run** -- Docker
      unavailable.
- [ ] Stop at the commit checkpoint. **Stopped here, awaiting approval.**

### Slice C — Rhythm

#### C1 — Status categories and custom workflow

- [x] Design the full status backfill and obtain the irreversible-migration
      checkpoint approval. Decisions recorded in `docs/plans/slice-c-plan.md`
      §8.0.
- [x] Confirm a database-volume backup exists before running the migration on
      anything other than a throwaway database. Verified backup at
      `data/kobi.db.pre-0006.bak` (`integrity_check ok`, matching row counts).
      **Note:** the operator's live database is the host `./data/kobi.db`, not
      the Docker `kobi-data` volume, which held a near-empty leftover. Neither
      has taken 0006 yet, so the next boot applies 0006, 0007 and 0008 together.
- [x] Add statuses, category validation, task status references, and
      `startedAt` behavior.
- [x] Seed existing workspaces and backfill every task without null status IDs.
      All three workspace-creation paths seed, not just `createWorkspace`:
      `status_id` is NOT NULL, so signup and the invite-removal fallback
      workspace needed it too.
- [x] Remove the legacy status column/check constraint in the approved
      migration. Split across two files rather than one: `drizzle-kit` cannot
      tell whether `status` -> `status_id` is a rename and demands an
      interactive answer, so 0007 is additive (table, seed, backfill) and 0008
      is destructive (drop + NOT NULL). Each reflects a real intermediate schema
      state, so the snapshots stay consistent.
- [x] Update completion logic, progress exclusion, status editing, and ordering.
      `server/utils/task-points.ts` is now the single definition of both the
      weighting and the completed/canceled rule.
- [x] Add migration, transition, progress, rename, and isolation tests,
      including the same-workspace second-member case.
- [x] Run the tester and reviewer roles. Review returned no blocking defect.
      Fixed from it: `deleteStatus` reassigning recurring work into a closed
      status killed the recurrence chain permanently (now 422); the
      `taskMutationBody` drift guard did not actually guard anything (a spread
      loses excess-property checking -- now an exhaustive mapped type, verified
      by adding a display-only field and seeing it fail to compile); reorder and
      set-default were not invalidating task caches; and `s` could cycle a task
      into Canceled.
- [x] Run `./scripts/verify.sh`; record the exact result. **VERIFY: PASS** --
      image build, Biome lint, Nuxt typecheck, 341 tests and the production
      build, all inside Docker. First full gate run of the programme; Slices A
      and B were verified locally only, Docker being unavailable at the time.
- [x] Stop at the commit checkpoint. Approved and committed.

#### C2 — Cycles

- [ ] Add workspace-scoped cycles, task cycle references, and cycle settings.
- [ ] Implement enablement, future-cycle creation, rollover, auto-add, and
      server-side time-derived closure.
- [ ] Implement velocity and capacity-dial behavior, returning `null` with
      fewer than three completed cycles.
- [ ] Integrate active-cycle priorities with the existing daily selections.
- [ ] Add cycle, velocity, rollover, numbering, disablement, and isolation
      tests.
- [ ] Obtain schema checkpoint approval, generate, and review the migration.
- [ ] Run the tester and reviewer roles.
- [ ] Run `./scripts/verify.sh`; record the exact result.
- [ ] Stop at the commit checkpoint.

### Slice D — Leverage

#### D1 — Task relations

- [ ] Add canonical task relations, type validation, uniqueness, and indexes.
- [ ] Implement inverse/symmetric reads, self/cross-workspace rejection, and
      resolved blockers.
- [ ] Extract task-key mentions from descriptions/comments idempotently.
- [ ] Add relation and delete-cascade tests.
- [ ] Obtain schema checkpoint approval, generate, and review the migration.
- [ ] Run the tester and reviewer roles.
- [ ] Run `./scripts/verify.sh`; record the exact result.
- [ ] Stop at the commit checkpoint.

#### D2 — Comments and activity

- [ ] Add comments and activity-event schema, validation, and workspace scope.
- [ ] Write activity from services inside the same transaction as each
      mutation.
- [ ] Implement author-only comment edit/delete and soft deletion.
- [ ] Merge comments and activity chronologically in the task panel.
- [ ] Add transaction rollback, permissions, redaction/length, and isolation
      tests.
- [ ] Obtain schema checkpoint approval, generate, and review the migration.
- [ ] Run the tester and reviewer roles.
- [ ] Run `./scripts/verify.sh`; record the exact result.
- [ ] Stop at the commit checkpoint.

#### D3 — Insights and saved views

- [ ] Promote `taskFilterSchema` to the shared source of truth for filters,
      URLs, saved views, and insights.
- [ ] Add query-string round-tripping for every supported filter.
- [ ] Add saved views and list-preference integration.
- [ ] Add the validated insights endpoint with SQL aggregation, dimensions,
      measures, and p50/p90 handling.
- [ ] Add the insights sidebar and keyboard shortcut.
- [ ] Test empty workspaces, cross-workspace isolation, and hand-computed
      percentile fixtures.
- [ ] Obtain schema checkpoint approval for saved views, generate, and review
      the migration.
- [ ] Run the tester and reviewer roles.
- [ ] Run `./scripts/verify.sh`; record the exact result.
- [ ] Stop at the commit checkpoint.

### Slice E — Intelligence

#### E1 — Additional AI proposal kinds

- [ ] Add discriminated proposal schemas and per-kind bounds without changing
      `goalPlanProposalSchema`.
- [ ] Extend the provider JSON schema and bump the AI prompt version.
- [ ] Implement transactional acceptance dispatch for every new kind.
- [ ] Add proposal round-trip, rejection, malformed-reply, and regression tests.
- [ ] Add eval cases for every kind and run the evaluator before the reviewer.
- [ ] Confirm `offline` and `invalid` sources remain visible to clients.
- [ ] Obtain approval before any command that could make more than 50 paid
      provider calls.
- [ ] Run the tester, evaluator, and reviewer roles.
- [ ] Run `./scripts/verify.sh`; record the exact result.
- [ ] Stop at the commit checkpoint.

#### E2 — MCP server

- [ ] Decide the MCP transport and authentication boundary before implementation.
- [ ] Obtain approval before installing the MCP SDK dependency.
- [ ] Add hashed, revocable API tokens and workspace-scoped authorization.
- [ ] Expose task, project, goal, cycle, insight, and proposal-creation tools.
- [ ] Reuse existing Zod schemas for tool inputs and keep proposals pending.
- [ ] Test revoked tokens, cross-workspace isolation, and pending proposals.
- [ ] Run the tester and reviewer roles.
- [ ] Run `./scripts/verify.sh`; record the exact result.
- [ ] Stop at the commit checkpoint.

### Cross-cutting completion

- [ ] Add PostHog events for each capability using flags and enums only.
- [ ] Confirm every private read/write includes authenticated user or workspace
      scope.
- [ ] Confirm browser code never accesses SQLite, secrets, or provider keys.
- [ ] Confirm all API input and AI output is Zod-validated.
- [ ] Confirm AI proposals remain inert until explicit acceptance and persist
      transactionally.
- [ ] Confirm empty goals/projects and unmeasured metrics return `null`, not 0.
- [ ] Confirm no named-volume data was deleted and no secrets were added.
- [ ] Confirm every slice has its acceptance criteria, isolation tests, review,
      and exact verification result recorded.
- [ ] Keep the programme's out-of-scope decisions unchanged unless a separate
      decision is approved.
