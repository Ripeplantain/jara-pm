# Kobi build plan

Kobi started as a single-user Kanban MVP (phases 0-5, shipped). It is now being grown into a
comprehensive product-management app: shared workspaces, user management, many boards, rich
cards, planning, insights, and an AI assistant that understands all of it.

This file is the memory of the [Ralph loop](../PROMPT.md). One iteration = the first unchecked
task. Tick it when `./scripts/verify.sh` prints `VERIFY: PASS`.

**Status: phases 0-5 shipped. Phase 6 is the current frontier.**

---

## Ground rules for every phase

- Every new table hangs off a workspace, directly or through a board. Access is decided by
  workspace membership, never by a client-supplied id.
- Roles, weakest to strongest: `viewer` < `member` < `admin` < `owner`.
  - viewer: read everything in the workspace.
  - member: everything viewers can do, plus create/edit/move/delete cards, columns and boards.
  - admin: plus manage members (invite, change role below their own, remove), labels, and
    workspace settings.
  - owner: plus transfer ownership and delete the workspace. Exactly one per workspace.
- Migrations are additive and backfill. Existing single-user data must survive untouched.
- Every mutation that users can see in the activity feed goes through the service layer, so the
  AI and the UI produce identical records.

---

## Phase 6 - Workspaces and user management (backend)

- [x] 6.1 `workspaces` + `workspace_members` models and migration. Backfill: one workspace per
  existing user named `<email local part>'s workspace`, membership role `owner`.
- [x] 6.2 Add `boards.workspace_id` (migration backfills each board to its owner's workspace)
  and keep `boards.created_by_id` as provenance. Board queries scope by workspace membership
  instead of `owner_id`.
- [ ] 6.3 Permission layer: `app/services/permissions.py` with `require_workspace(db, user, id,
  min_role)` and board/column/card variants. Every board endpoint uses it. A workspace the user
  is not a member of is a 404; too weak a role is a 403.
- [ ] 6.4 Workspace CRUD endpoints: list mine, create, rename, delete (owner only), plus
  `GET /api/workspaces/{id}` with members.
- [ ] 6.5 Member management endpoints: list, add by email (existing user), change role, remove.
  Guard rails: cannot remove or demote the last owner; cannot grant a role above your own.
- [ ] 6.6 Invitations for people who have not signed up yet: `workspace_invites` (email, role,
  token, expires_at). Pending invites are accepted automatically at registration.
- [ ] 6.7 User profile: `users.display_name`, `users.avatar_color`, `users.is_active`.
  `GET/PATCH /api/me`, `POST /api/me/password` (requires the current password).

### Notes
- 6.1: `WorkspaceRole` is a `str` enum in `app/models/workspace.py` with `rank` ordering; DB
  column stores the string value.
- 6.2: boards keep `created_by_id`; all scoping now goes through `workspace_members`.
- 6.2: **SQLite migration trap.** Alembic batch mode rebuilds a table by dropping it and renaming
  a copy in; with `PRAGMA foreign_keys=ON` that DROP cascade-deletes every child row (it wiped
  columns and cards on the first attempt). `migrations/env.py` now opens the engine with
  `enforce_foreign_keys=False`; the app still runs with enforcement on. Any migration that
  rebuilds a table needs a test that seeds child rows first.
- 6.2: `create_board` without a `workspace_id` uses the caller's oldest workspace, which keeps the
  old single-user API and the AI's `create_board` tool working unchanged.
- 6.3: `permissions.py` raises `NotFound` (hidden workspace) or `Forbidden` (role too weak);
  `main.py` maps `Forbidden` to 403.
- 6.5: last-owner and role-escalation guard rails live in `services/workspaces.py`.
- 6.6: invites are accepted on register by email match; `token` is for a future email link.
- 6.7: password change revokes nothing yet (tokens stay valid until expiry) - noted for later.

## Phase 7 - Rich cards (backend)

- [ ] 7.1 Labels: `labels` (workspace-scoped: name, color) + `card_labels` join, CRUD endpoints,
  attach/detach on a card.
- [ ] 7.2 Card fields: `assignee_id`, `priority`, `due_date`, `estimate`, `created_by_id`,
  `updated_at`, `completed_at`, `archived_at`. Assignee must be a member of the workspace.
- [ ] 7.3 Checklists: `checklist_items` (card, text, done, position) with add/toggle/rename/
  reorder/delete; card output carries `checklist_done`/`checklist_total`.
- [ ] 7.4 Comments: `comments` (card, author, body, timestamps), list/create/edit/delete. Only
  the author or an admin can edit or delete.
- [ ] 7.5 Activity log: `activities` (workspace, board, card, actor, action, summary, meta) written
  by the service layer for every mutation; `GET /api/boards/{id}/activity`.
- [ ] 7.6 Archive instead of delete for cards: `POST /api/cards/{id}/archive` + `/unarchive`,
  archived cards excluded from board reads unless `?include_archived=true`.

### Notes
- 7.1: label colors come from a fixed palette (`LABEL_COLORS` in `app/models/label.py`) so the
  UI never renders an arbitrary hex.
- 7.2: `Priority` is a str enum (none/low/medium/high/urgent); `completed_at` is set by moving a
  card into a column flagged `is_done` (see 9.2), not by a direct field write.
- 7.3: checklist items renumber like cards - contiguous 0..n-1, one commit.
- 7.4: comment bodies are plain text, capped at 5000 chars; `@mentions` are parsed in 10.2.
- 7.5: `record()` in `services/activity.py` is called inside the mutating service functions, so
  AI and UI writes look identical. Activity is append-only and never edited.
- 7.6: archiving is the default destructive action in the UI; delete stays for hard removal.

## Phase 8 - Planning (backend)

- [ ] 8.1 Sprints: `sprints` (board, name, goal, starts_on, ends_on, state) + `cards.sprint_id`,
  CRUD, and `POST /api/sprints/{id}/start|complete` (completing moves unfinished cards to the
  backlog or the next sprint).
- [ ] 8.2 Column settings: `columns.wip_limit` and `columns.is_done`. Exceeding a WIP limit is a
  warning in the API response, never a hard block.
- [ ] 8.3 Filtering and search: `GET /api/boards/{id}/cards` with `q`, `assignee_id`, `label_id`,
  `priority`, `due_before`, `sprint_id`, `archived`, and `GET /api/workspaces/{id}/search`.
- [ ] 8.4 Board templates: built-in templates (Kanban, Scrum, Bug triage, Content calendar,
  Product roadmap) and `POST /api/boards/from-template`.
- [ ] 8.5 Favourites: `board_favorites` join table, `POST/DELETE /api/boards/{id}/favorite`,
  surfaced in the board list.

### Notes
- 8.1: completing a sprint is a single transaction; unfinished cards keep their column.
- 8.2: WIP warnings ride along in the move/create response as `warnings: [...]`.
- 8.3: search is SQL `LIKE` over title/description - good enough for SQLite, no FTS table yet.
- 8.4: templates are declarative data in `app/services/templates.py`, not DB rows.

## Phase 9 - Insights and notifications (backend)

- [ ] 9.1 Analytics: `GET /api/boards/{id}/analytics` - cards per column, throughput per week,
  average cycle time, workload per assignee, overdue and due-soon counts.
- [ ] 9.2 Notifications: `notifications` table + `GET /api/notifications`, mark read / mark all
  read. Written when a card is assigned to someone else, a comment mentions them, or a card
  they are assigned to is moved to done.
- [ ] 9.3 Workspace dashboard endpoint: `GET /api/workspaces/{id}/overview` - board summaries,
  recent activity, my assigned cards across boards, upcoming due dates.

### Notes
- 9.1: cycle time uses `created_at` -> `completed_at` in whole hours; cards without both are
  excluded and reported as `sample_size`.
- 9.2: a user is never notified about their own action.

## Phase 10 - Frontend: workspaces, members, navigation

- [ ] 10.1 Types + API client for everything phases 6-9 added (`lib/types/*`, `lib/api/*`), and
  widen the proxy allowlist.
- [ ] 10.2 App shell: workspace switcher, primary nav (Boards, My work, Insights, Members,
  Settings), notification bell with unread count, account menu.
- [ ] 10.3 Boards dashboard: favourites first, search, role-aware create button, create from
  template dialog, archive/delete with confirmation.
- [ ] 10.4 Members page: list with roles and avatars, invite by email, change role, remove,
  pending invitations, all guarded by the viewer's role.
- [ ] 10.5 Profile and workspace settings pages: display name, avatar colour, password change,
  workspace rename, label management, danger zone.

### Notes
- 10.1: browser client mirrors the backend one-to-one; no component builds its own URLs.
- 10.2: the switcher writes the active workspace to a cookie so server components can read it.

## Phase 11 - Frontend: the board experience

- [ ] 11.1 Card detail drawer: title, description, assignee, priority, due date, estimate,
  labels, sprint, checklist, comments, activity. Deep-linkable at `/boards/{id}?card={cardId}`.
- [ ] 11.2 Filter bar on the board: text search, assignee, label, priority, due, "only mine",
  with the active filter count and a clear button.
- [ ] 11.3 Card face: labels, assignee avatar, due-date pill (overdue styling), priority dot,
  checklist progress, comment count.
- [ ] 11.4 Column settings: WIP limit with an over-limit warning, "done" flag, collapse.
- [ ] 11.5 Sprint bar: active sprint, dates, progress, start/complete actions.
- [ ] 11.6 Keyboard and a11y pass over everything new: focus traps in the drawer, escape to
  close, labelled controls, reduced motion, and the existing non-drag move fallbacks.

### Notes
- 11.1: the drawer is a client component fed by the board state; it never refetches the board.
- 11.3: card faces stay under ~120px tall so a column still shows several cards.

## Phase 12 - Frontend: insights, my work, polish

- [ ] 12.1 Insights page per board: column distribution, throughput, cycle time, workload,
  overdue - charts drawn as accessible SVG with a table fallback.
- [ ] 12.2 "My work" page: cards assigned to me across every board in the workspace, grouped by
  due date, with quick status changes.
- [ ] 12.3 Activity feed page for the workspace with filters by board and actor.
- [ ] 12.4 Dark mode via the existing token set, respecting `prefers-color-scheme` plus a manual
  toggle stored per user.
- [ ] 12.5 Empty states, skeletons and error boundaries for every new page.

### Notes
- 12.1: no chart library - inline SVG keeps the bundle small and the markup describable.

## Phase 13 - AI assistant upgrade

- [ ] 13.1 New tools: set assignee, priority, due date, estimate; add/remove labels; add
  checklist items; comment on a card; archive a card.
- [ ] 13.2 Sprint and planning tools: create a sprint, add cards to it, start/complete it.
- [ ] 13.3 Context upgrade: the assistant sees members, labels, sprints and the active filter,
  and is told the acting user's role so it never proposes what they cannot do.
- [ ] 13.4 Workspace-level assistant: create boards from templates, summarise progress, and
  answer "what is blocked?" using the analytics endpoint.
- [ ] 13.5 Permission and confirmation tests for every new tool: a viewer's AI call can read but
  never write, and destructive tools still only propose.

### Notes
- 13.3: the context builder sends ids and display names only - never emails, never password
  hashes, never tokens.
- 13.5: tool authorisation is enforced in the service layer, not in the prompt.

## Phase 14 - Docs and ops

- [ ] 14.1 Update `agents.md`, `backend/agents.md`, `frontend/agents.md` for the new scope,
  data model and rules.
- [ ] 14.2 Update `README.md` (features, setup, roles) and `.env.example` if config changed.
- [ ] 14.3 Seed script for a demo workspace with two users, boards, labels and a sprint.
- [ ] 14.4 Final pass: `./scripts/verify.sh`, plus a manual smoke of the main flows, recorded
  here.

### Notes
- 14.4: record the exact commands run and anything that could not be verified.
