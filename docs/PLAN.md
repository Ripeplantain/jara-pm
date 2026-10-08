# Kobi build plan

Kobi started as a single-user Kanban MVP (phases 0-5, shipped). It is now being grown into a
comprehensive product-management app: shared workspaces, user management, many boards, rich
cards, planning, insights, and an AI assistant that understands all of it.

This file is the memory of the [Ralph loop](../PROMPT.md). One iteration = the first unchecked
task. Tick it when `./scripts/verify.sh` prints `VERIFY: PASS`.

**Status: phases 0-14 shipped; SaaS MVP tasks 15.1-15.6, 16.1-16.6, 17.1-17.6, 18.1-18.4, and 19.1-19.4 are complete. The first unchecked task is 18.5. The visual redesign workstream is tracked separately in [docs/UI-REDESIGN-TODO.md](UI-REDESIGN-TODO.md).**

---

## Ground rules for every phase

- Every new table hangs off a workspace, directly or through a board. Access is decided by
  workspace membership, never by a client-supplied id.
- Roles, weakest to strongest: `viewer` < `member` < `admin` < `owner`.
  - viewer: read everything in the workspace.
  - member: everything viewers can do, plus create/edit/move/delete cards, columns and boards.
  - admin: plus manage members (invite, change role below their own, remove), rename or delete
    labels (that changes every board at once), and workspace settings. Members may *create* and
    attach labels, which is ordinary day-to-day work.
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
- [x] 6.3 Permission layer: `app/services/permissions.py` with `require_workspace(db, user, id,
  min_role)` and board/column/card variants. Every board endpoint uses it. A workspace the user
  is not a member of is a 404; too weak a role is a 403.
- [x] 6.4 Workspace CRUD endpoints: list mine, create, rename, delete (owner only), plus
  `GET /api/workspaces/{id}` with members.
- [x] 6.5 Member management endpoints: list, add by email (existing user), change role, remove.
  Guard rails: cannot remove or demote the last owner; cannot grant a role above your own.
- [x] 6.6 Invitations for people who have not signed up yet: `workspace_invites` (email, role,
  token, expires_at). Pending invites are redeemed during token-bound registration.
- [x] 6.7 User profile: `users.display_name`, `users.avatar_color`, `users.is_active`.
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
- 6.6: invite records and role assignment are workspace-scoped; final SaaS delivery requires the
  emailed token at registration, as documented in 15.3.
- 6.7: password change revokes nothing yet (tokens stay valid until expiry) - noted for later.

## Phase 7 - Rich cards (backend)

- [x] 7.1 Labels: `labels` (workspace-scoped: name, color) + `card_labels` join, CRUD endpoints,
  attach/detach on a card.
- [x] 7.2 Card fields: `assignee_id`, `priority`, `due_date`, `estimate`, `created_by_id`,
  `updated_at`, `completed_at`, `archived_at`. Assignee must be a member of the workspace.
- [x] 7.3 Checklists: `checklist_items` (card, text, done, position) with add/toggle/rename/
  reorder/delete; card output carries `checklist_done`/`checklist_total`.
- [x] 7.4 Comments: `comments` (card, author, body, timestamps), list/create/edit/delete. Only
  the author or an admin can edit or delete.
- [x] 7.5 Activity log: `activities` (workspace, board, card, actor, action, summary, meta) written
  by the service layer for every mutation; `GET /api/boards/{id}/activity`.
- [x] 7.6 Archive instead of delete for cards: `POST /api/cards/{id}/archive` + `/unarchive`,
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

- [x] 8.1 Sprints: `sprints` (board, name, goal, starts_on, ends_on, state) + `cards.sprint_id`,
  CRUD, and `POST /api/sprints/{id}/start|complete` (completing moves unfinished cards to the
  backlog or the next sprint).
- [x] 8.2 Column settings: `columns.wip_limit` and `columns.is_done`. Exceeding a WIP limit is a
  warning in the API response, never a hard block.
- [x] 8.3 Filtering and search: `GET /api/boards/{id}/cards` with `q`, `assignee_id`, `label_id`,
  `priority`, `due_before`, `sprint_id`, `archived`, and `GET /api/workspaces/{id}/search`.
- [x] 8.4 Board templates: built-in templates (Kanban, Scrum, Bug triage, Content calendar,
  Product roadmap) and `POST /api/boards/from-template`.
- [x] 8.5 Favourites: `board_favorites` join table, `POST/DELETE /api/boards/{id}/favorite`,
  surfaced in the board list.

### Notes
- 8.1: completing a sprint is a single transaction; unfinished cards keep their column.
- 8.2: WIP limits surface as `card_count` and `over_wip_limit` on every column in the board
  response, rather than as a warning envelope around the card write. The UI can then show the
  state continuously instead of only right after a move, and no response shape had to change.
- 8.3: search is SQL `LIKE` over title/description - good enough for SQLite, no FTS table yet.
- 8.4: templates are declarative data in `app/services/templates.py`, not DB rows.

## Phase 9 - Insights and notifications (backend)

- [x] 9.1 Analytics: `GET /api/boards/{id}/analytics` - cards per column, throughput per week,
  average cycle time, workload per assignee, overdue and due-soon counts.
- [x] 9.2 Notifications: `notifications` table + `GET /api/notifications`, mark read / mark all
  read. Written when a card is assigned to someone else, a comment mentions them, or a card
  they are assigned to is moved to done.
- [x] 9.3 Workspace dashboard endpoint: `GET /api/workspaces/{id}/overview` - board summaries,
  recent activity, my assigned cards across boards, upcoming due dates.

### Notes
- 9.1: cycle time uses `created_at` -> `completed_at` in whole hours; cards without both are
  excluded and reported as `sample_size`.
- 9.2: a user is never notified about their own action.

## Phase 10 - Frontend: workspaces, members, navigation

- [x] 10.1 Types + API client for everything phases 6-9 added (`lib/types/*`, `lib/api/*`), and
  widen the proxy allowlist.
- [x] 10.2 App shell: workspace switcher, primary nav (Boards, My work, Insights, Members,
  Settings), notification bell with unread count, account menu.
- [x] 10.3 Boards dashboard: favourites first, search, role-aware create button, create from
  template dialog, archive/delete with confirmation.
- [x] 10.4 Members page: list with roles and avatars, invite by email, change role, remove,
  pending invitations, all guarded by the viewer's role.
- [x] 10.5 Profile and workspace settings pages: display name, avatar colour, password change,
  workspace rename, label management, danger zone.

### Notes
- 10.1: browser client mirrors the backend one-to-one; no component builds its own URLs.
- 10.2: the switcher writes the active workspace to a cookie so server components can read it.

## Phase 11 - Frontend: the board experience

- [x] 11.1 Card detail drawer: title, description, assignee, priority, due date, estimate,
  labels, sprint, checklist, comments, activity. Deep-linkable at `/boards/{id}?card={cardId}`.
- [x] 11.2 Filter bar on the board: text search, assignee, label, priority, due, "only mine",
  with the active filter count and a clear button.
- [x] 11.3 Card face: labels, assignee avatar, due-date pill (overdue styling), priority dot,
  checklist progress, comment count.
- [x] 11.4 Column settings: WIP limit with an over-limit warning, "done" flag, collapse.
- [x] 11.5 Sprint bar: active sprint, dates, progress, start/complete actions.
- [x] 11.6 Keyboard and a11y pass over everything new: focus traps in the drawer, escape to
  close, labelled controls, reduced motion, and the existing non-drag move fallbacks.

### Notes
- 11.1: the drawer is a client component fed by the board state; it never refetches the board.
- 11.3: card faces stay under ~120px tall so a column still shows several cards.

## Phase 12 - Frontend: insights, my work, polish

- [x] 12.1 Insights page per board: column distribution, throughput, cycle time, workload,
  overdue - charts drawn as accessible SVG with a table fallback.
- [x] 12.2 "My work" page: cards assigned to me across every board in the workspace, grouped by
  due date, with quick status changes.
- [x] 12.3 Activity feed page for the workspace with filters by board and actor.
- [x] 12.4 Dark mode via the existing token set, respecting `prefers-color-scheme` plus a manual
  toggle stored per user.
- [x] 12.5 Empty states, skeletons and error boundaries for every new page.

### Notes
- 12.1: no chart library - inline SVG keeps the bundle small and the markup describable.

## Phase 13 - AI assistant upgrade

- [x] 13.1 New tools: set assignee, priority, due date, estimate; add/remove labels; add
  checklist items; comment on a card; archive a card.
- [x] 13.2 Sprint and planning tools: create a sprint, add cards to it, start/complete it.
- [x] 13.3 Context upgrade: the assistant sees members, labels, sprints and the active filter,
  and is told the acting user's role so it never proposes what they cannot do.
- [x] 13.4 Workspace-level assistant: create boards from templates, summarise progress, and
  answer "what is blocked?" using the analytics endpoint.
- [x] 13.5 Permission and confirmation tests for every new tool: a viewer's AI call can read but
  never write, and destructive tools still only propose.

### Notes
- 13.3: the context builder sends ids and display names only - never emails, never password
  hashes, never tokens.
- 13.5: tool authorisation is enforced in the service layer, not in the prompt.

## Phase 14 - Docs and ops

- [x] 14.1 Update `agents.md`, `backend/agents.md`, `frontend/agents.md` for the new scope,
  data model and rules.
- [x] 14.2 Update `README.md` (features, setup, roles) and `.env.example` if config changed.
- [x] 14.3 Seed script for a demo workspace with two users, boards, labels and a sprint.
- [x] 14.4 Final pass: `./scripts/verify.sh`, plus a manual smoke of the main flows, recorded
  here.

### Notes
- 14.2: `.env.example` needed no change - phases 6-14 added no configuration.
- 14.3: `python -m app.seed` builds everything through the service layer, so the activity feed and
  the notifications it produces are real rather than backfilled. It refuses to run twice.
- 14.4: **verification, 2026-09-25.**

  `./scripts/verify.sh` -> `VERIFY: PASS`. Docker was not running on this machine, so it used the
  host fallback: `backend/.venv/bin/pytest -q` (**215 passed**), `ruff check .`, and
  `npm run lint` / `npm run typecheck` in `frontend/` on Node 22.22. `npm run build` also
  succeeds and emits all 15 routes.

  Manual smoke against a live `uvicorn` on a seeded database, 30 flows, all as designed:

  | | Flow | Result |
  |---|---|---|
  | 1-3 | Sign in as two people; workspaces with roles; boards, favourite first | ok |
  | 4-5 | Board read: WIP counts, done column; card with assignee, labels, checklist, comments | ok |
  | 6-7 | Workspace overview; analytics (throughput, cycle time, workload, overdue) | ok |
  | 8-10 | Notifications; "my work"; workspace search with board and column | ok |
  | 11 | Creating a card over a WIP limit **warns and still saves** | ok |
  | 12-13 | Move a card; set assignee, due date, estimate, label | ok |
  | 14 | The assignee is notified, unread | ok |
  | 15 | Checklist item and a comment from the other person | ok |
  | 16 | Archive: off the board, in the archive, restored | ok |
  | 17 | Activity feed shows all six actions with the right actor | ok |
  | 18-19 | Invite an address with no account; they register and land in the workspace as viewer | ok |
  | 20-21 | Viewer reads board, activity and analytics (200); writes refused 403 with a readable reason | ok |
  | 22 | Outsider: 404 everywhere, empty board list | ok |
  | 23-24 | Last owner cannot be demoted; an admin cannot grant `owner` | ok |
  | 25-26 | Sprint progress; completing a sprint rolls 2 unfinished cards into the next one | ok |
  | 27-28 | Five templates; a board built from one, with its done column set | ok |
  | 29 | Filter by priority | ok |
  | 30 | Assistant with no `LLM_API_KEY`: 503 with a clear message, board unaffected | ok |

  **Fixed during this pass:** cycle time could come out as `-0.0h` for a card created directly
  into a done column (`completed_at` beat its own `created_at` by microseconds). Clamped at zero
  in `services/analytics.py`, with a regression test.

  **Not verified.** No browser was driven: the UI is covered by types, lint and a production
  build, not by a rendering test, so the visual result of the new pages and dark mode is
  unverified. Docker itself could not be exercised (no daemon on this machine), so the compose
  stack, the production image targets and the container start-up migration are unchanged but
  untested here. No live LLM was called - the AI tool loop is covered by the scripted fake only.
  Accessibility has not been checked with axe or a screen reader.

---

# SaaS MVP implementation track

The next release is intentionally narrower than a complete enterprise product. Kobi's SaaS MVP
must let a small product team sign up, create or join a workspace, invite teammates, plan and
execute a sprint, ask the assistant for useful product guidance, and trust the application with
their data. The existing board, workspace, sprint, insights, notification and typed-tool work is
the foundation; these phases harden and package it for real users.

## MVP scope decisions

- **In the MVP:** account lifecycle, onboarding, workspace collaboration, the existing board/sprint
  loop, a polished responsive SaaS shell, a focused AI copilot, usage protection, backups,
  monitoring, privacy/terms, and a documented deployment path.
- **Conditional:** billing and paid-plan enforcement are required for a paid launch, but may follow
  the invite-only beta gate. The plan must record the decision before billing work begins.
- **Deferred:** real-time sync, mobile apps, file attachments, third-party integrations, full OKR
  management, advanced roadmap/Gantt tooling, enterprise SSO, and unrestricted custom automation.
- **Definition of done:** every phase keeps `./scripts/verify.sh` green, adds focused backend tests
  for new behavior, updates mirrored frontend types/contracts, and records any manual verification.

## Phase 15 - SaaS foundation and onboarding

- [x] 15.1 Define the launch mode (invite-only beta or paid public SaaS), target user/team size,
  initial workspace/card/AI limits, and the production deployment target. Record the decisions in
  this plan before implementing plan enforcement or provider-specific infrastructure.
- [x] 15.2 Add account recovery and lifecycle: email verification, password reset with expiring
  single-use tokens, change-password session handling, account deactivation/deletion, and tests
  that never expose credentials or token values.
- [x] 15.3 Finish invitation delivery: create/resend/revoke/expire invite flows, a server-side
  email adapter with a development-safe sink, redeem links, and clear pending-invite states. Keep
  registration and invite acceptance transactional.
- [x] 15.4 Add first-run onboarding: workspace name, team/product context, board template, first
  sprint, and teammate invitation. Returning users should skip onboarding and land on their active
  workspace. Add empty states and a seeded demo path without weakening permissions.
- [x] 15.5 Add SaaS-safe abuse controls: rate limits for registration, login, password reset,
  invitations, and AI requests; request-size limits; security headers; and redacted structured
  logs. Cover the limits with request-level tests.
- [x] 15.6 Add privacy and data lifecycle basics: privacy/terms pages, workspace data export,
  workspace deletion confirmation, account deletion behavior, and documentation of retained data.

### Notes

- 15.1: launch starts as an invite-only beta for small product teams of 2-10 people. The initial
  target is one workspace per team, with a planning baseline of 10 members, 25 boards, 2,500 active
  cards, and 500 AI actions per workspace per month; enforcement is a later task. Deployment is a
  single-host Docker Compose production stack behind HTTPS with one backend replica and persistent
  database storage. Resend is the transactional email provider; `RESEND_API_KEY` and the verified
  `RESEND_FROM_EMAIL` remain backend-only, with optional `RESEND_REPLY_TO`.

- Keep SQLite for the first low-volume beta only if the deployment has one backend replica, a
  persistent volume, tested backups, and a restore runbook. If the launch target needs multiple
  replicas or materially higher concurrency, make PostgreSQL the separate migration project rather
  than quietly changing the database inside this phase.
- Email delivery is now in scope because invitations, verification, and recovery are required for
  a public SaaS. The adapter must keep provider keys server-side and remain replaceable in tests.
- 15.2: account lifecycle tokens are stored as SHA-256 hashes, expire after 24 hours, and are
  single-use. `auth_version` invalidates existing access tokens after password changes, resets,
  and deactivation. Resend is lazy-loaded by the backend adapter; local/test environments use a
  no-op sink when email credentials are absent. `REQUIRE_EMAIL_VERIFICATION` gates production
  login without affecting the invite-only development workflow.
- 15.3: invitation links use the existing workspace-invite token, are bound to the invited email
  during registration, and an open invite cannot be redeemed by registering with the email alone.
  Links expire after 14 days and are never returned by API responses. Create and resend commit
  before attempting delivery; Resend failures leave the invite usable and visible so an admin can
  retry.
- 15.4: first-run setup is tracked per user in `onboarding_profiles`; it renames the initial
  workspace, creates a selected template board and first sprint, sends optional teammate invites,
  and offers a deterministic demo starter. The home dashboard redirects users without a profile to
  `/onboarding`; the backend remains the authority for workspace membership and template access.
- 15.5: the single-replica beta uses a process-local sliding-window limiter keyed by client IP,
  configurable through `RATE_LIMIT_*` environment variables. Requests over 256 KiB are rejected,
  security headers are added to API responses, and HTTP logs redact invitation tokens; replace the
  limiter with shared storage before scaling beyond one backend replica.
- 15.6: workspace exports contain collaboration data but never password hashes, account tokens or
  other secrets. Workspace deletion requires the exact `DELETE` confirmation and an owner cannot
  remove their only workspace. Account deletion removes eligible personal workspaces and requires
  ownership transfer for shared workspaces; policy summaries live at `/privacy` and `/terms`.

## Phase 16 - Modern SaaS UI refresh

- [x] 16.1 Consolidate the visual system in `frontend/app/globals.css`: spacing and typography
  scales, button/input/badge/modal/drawer/toast states, status colors, responsive breakpoints,
  dark-mode tokens, focus states, and reduced-motion behavior.
- [x] 16.2 Refresh the application shell with a collapsible sidebar, stronger workspace switcher,
  global search entry, command palette, notification center, account menu, breadcrumbs, and a
  persistent AI assistant entry point.
- [x] 16.3 Redesign the dashboard around action: AI briefing, my work due soon, blocked cards,
  current sprint health, recent activity, favorite boards, workspace metrics, and clear quick
  actions. Preserve fast loading and role-aware controls.
- [x] 16.4 Upgrade the board and card drawer: toolbar filters/grouping, density controls, improved
  card metadata hierarchy, related/blocked cards, checklist progress, activity timeline, sticky
  actions, undo for reversible actions, and keyboard-friendly alternatives to drag and drop.
- [x] 16.5 Add complete loading, empty, error, success, and offline/retry states across onboarding,
  dashboard, boards, members, settings, insights, activity, and AI. Verify narrow screens,
  keyboard navigation, contrast, focus, and screen-reader labels.
- [x] 16.6 Perform a visual QA pass against the dashboard, board, card drawer, onboarding, and AI
  states in light and dark themes. Record browser verification because no frontend rendering test
  framework exists yet.

### Notes

- Reuse the existing CSS-token approach and components in `frontend/components/`; do not add a
  competing styling or component framework as part of the MVP refresh.
- Keep the board as the primary work surface. The dashboard should help users decide where to go,
  not become a second project-management system.
- 16.1: the existing token system now includes spacing, focus, motion, responsive, dark-mode and
  reduced-motion rules plus shared command, dashboard and state styles; no new component framework
  was introduced.
- 16.2: the signed-in shell now has a persistent collapsible sidebar, Cmd/Ctrl+K workspace search,
  breadcrumbs, notification/account controls and a persistent Ask Kobi entry. Viewer navigation
  hides write-only board controls while preserving read access.
- 16.3: the dashboard now combines an AI briefing, workspace metrics, favorite boards, recent
  activity, deterministic overdue/blocked/WIP/stale signals with board/card evidence links, and
  active sprint health. Signals are derived by the backend rather than invented by the model.
- 16.5: route-level loading/error states now cover the dashboard and onboarding in addition to the
  existing work surfaces; the shell shows offline status, search failures are actionable, and the
  notification center exposes a retry-by-reopen state. Human screen-reader verification remains a
  release gate alongside the completed visual QA pass.
- 16.4: board grouping is view-only while active so card ordering cannot be accidentally mutated;
  compact density, related/suspected-blocker work, sticky drawer metadata, checklist/activity
  sections, keyboard move controls and archive undo are implemented without a new UI framework.
- Historical verification checkpoint, 2026-10-08: `./scripts/verify.sh` -> `VERIFY: PASS` with
  **247 backend tests**, Ruff, frontend lint and TypeScript. The production frontend build also
  succeeds and includes `/welcome`, invitation, recovery and onboarding routes. The later staging
  and browser evidence is recorded in the launch-gate notes below.

## Phase 17 - Focused AI copilot

- [x] 17.1 Define the MVP AI contract: read-only workspace questions, card improvement, task
  breakdown, sprint summary, standup update, and safe board/card mutations. Document which actions
  require confirmation and the response shape the frontend renders.
- [x] 17.2 Add structured read-only answers for “what should I work on next?”, “what is blocked?”,
  “what is at risk?”, board summaries, sprint summaries, and workload imbalance. Include concise
  evidence links to boards/cards rather than unsupported prose.
- [x] 17.3 Add card authoring tools for title/description improvement, acceptance criteria,
  subtasks, estimates, labels, priority, due dates, and suggested assignees. Suggestions must be
  previewable before mutation and use the existing service functions after approval.
- [x] 17.4 Add multi-change preview and confirmation: show the proposed operations, affected cards,
  rationale, permission failures, and partial-result handling before applying a batch. Destructive
  actions remain confirmation-only; every applied change appears in activity history.
- [x] 17.5 Add proactive AI signals to the workspace overview and notifications: stale work,
  overdue risk, sprint spillover, WIP pressure, missing ownership, and blocked dependencies.
  Start with deterministic analytics and use the LLM for explanation/summarization.
- [x] 17.6 Add AI evaluation and protection: scripted scenarios for tool choice, invalid IDs,
  permissions, confirmation, prompt injection attempts, secret exclusion, latency, provider errors,
  per-workspace limits, and usage/cost telemetry. Do not call a live provider in unit tests.

### Notes

- The AI remains a backend capability. The browser never calls the provider, and model output is
  never executed as code or raw SQL.
- Prefer deterministic facts from analytics/services over asking the model to calculate counts or
  infer permissions. The assistant should explain system results, not replace them.
- 17.3-17.4: card authoring is exposed as a review-only proposal tool. A 15-minute, user- and
  board-bound server token is single-use and is consumed before applying the approved operation;
  batch proposals validate every affected card before the first write and return every applied
  activity change.

## Phase 18 - Production operations and trust

- [x] 18.1 Implement the selected deployment target with separate staging and production
  environments, server-only secrets, HTTPS, health checks, single-replica SQLite constraints or
  the approved PostgreSQL topology, and a rollback procedure.
- [x] 18.2 Automate encrypted database backups, retention, restore verification, migration checks,
  and an operator runbook. Prove that restoring a backup preserves workspaces, membership, cards,
  activity, and notifications.
- [x] 18.3 Add error tracking and structured operational metrics for request failures, auth failures,
  AI latency/errors, background/email failures, database errors, and active workspaces. Redact
  tokens, passwords, hashes, email content, and LLM prompts where sensitive.
- [x] 18.4 Add product analytics for onboarding completion, first board/card/sprint, invitations,
  weekly active workspaces, AI usage, and retention signals without collecting unnecessary content.
- [ ] 18.5 Run an independent security review of tenant isolation, auth recovery, invite redemption,
  session/token handling, AI tools, rate limits, CORS, proxy allowlists, Docker permissions, and
  secret exposure. Add regression tests for each confirmed issue.

## Phase 19 - Launch readiness and monetization gate

- [x] 19.1 Add a public landing page, product explanation, sign-up CTA, support/contact path, and
  status/help content. Keep authenticated application navigation separate from marketing pages.
- [x] 19.2 If the launch mode is paid, add plans, entitlements, checkout, subscription webhooks,
  billing portal, seat/AI limits, upgrade prompts, cancellation, failed-payment handling, and
  tests for webhook idempotency. If launch is invite-only, explicitly record that billing is deferred.
- [x] 19.3 Prepare release documentation: setup, environment variables, deployment, backup/restore,
  support runbook, privacy/terms, known limitations, and a customer-facing changelog.
- [x] 19.4 Execute the SaaS MVP smoke test as a new user: sign up, verify/recover account, create a
  workspace, invite a teammate, create a board and sprint, use the AI copilot, confirm a proposed
  change, review activity/notifications, export/delete data, and verify access isolation.
- [ ] 19.5 Run `./scripts/verify.sh`, the production build, migration checks, backup restore test,
  manual browser smoke, and accessibility review. Record results and release only when every MVP
  gate is green or has an explicitly accepted risk.

### Release gates

- A new user reaches a useful workspace without operator database access.
- Two users can collaborate safely, and outsiders cannot discover workspace data.
- The AI produces useful, evidence-backed answers and cannot bypass permissions or apply unconfirmed
  destructive changes.
- The UI is usable on narrow screens, keyboard navigation works, and light/dark themes are coherent.
- Data can be backed up and restored, errors are observable, secrets are not exposed, and the deploy
  procedure is repeatable.
- Billing is either working and tested for a paid launch or explicitly deferred for an invite-only beta.

### Launch-gate notes

- 17.1: the AI contract, evidence-link expectations, confirmation model and evaluation scenarios
  are documented in `docs/AI_MVP.md`; existing typed tools remain the enforcement boundary.
- 19.1: unauthenticated `/` visitors go to the public `/welcome` landing page, with separate
  privacy/terms pages and a beta sign-up CTA. Authenticated application routes remain protected.
- 19.2: billing is explicitly deferred because the selected launch mode is invite-only beta; paid
  entitlements and checkout must be a separate project before public monetization.
- 19.3: setup remains in `README.md`; deployment, backup/restore, monitoring and rollback are in
  `docs/OPERATIONS.md`; customer-facing scope, support guidance and known limitations are in
  `docs/RELEASE.md`.
- 17.2: `POST /api/workspaces/{id}/ai` returns deterministic answers for next work, blocked work,
  risk and sprint health with evidence ids and suggested next actions; unsupported questions are
  rejected instead of receiving invented prose. Board-level `board_stats` remains the source for
  detailed board/workload summaries.
- 17.5: workspace overview signals now include stale work, overdue/blocked/WIP pressure, missing
  ownership and overdue active sprints; idempotent `ai.signal` notifications are created with a
  one-day cooldown.
- 17.6: AI action budgets are enforced per workspace/month. The protected metrics endpoint reports
  redacted request and product counters, while AI usage stores provider calls, latency and errors
  without prompts.
- 18.1-18.4: production and staging Compose overlays, encrypted retained backup scripts, a
  disposable migration check, authenticated redacted metrics, and content-free product events are
  implemented. Docker execution and target-host restore remain release gates.
- 19.4: `backend/tests/test_saas_smoke.py` covers registration and email-token boundaries,
  password recovery, onboarding, invitation redemption, board/sprint work, AI proposal approval,
  activity/notifications, export/deletion, and outsider isolation using only local fakes.
- Security follow-up, 2026-10-08: registration now refuses to redeem an open workspace invitation
  from the email address alone; the recipient must use the single-use link token delivered through
  Resend. The invite regression suite covers both the rejected bypass and successful token-bound
  registration.
- Verification, 2026-10-08: `./scripts/verify.sh` -> `VERIFY: PASS` with **247 backend tests**,
  Ruff, frontend lint and TypeScript. `bash scripts/migration-check.sh` passes against a disposable
  21-table database. The production frontend build passes with Next 16.4.0, and the production
  dependency audit reports zero production vulnerabilities. The full development audit still
  reports five high findings through the eslint-only `micromatch`/`braces` chain; the available
  audit fix would downgrade the Next lint configuration across major versions, so it is not used
  for the shipped production image.
- Docker staging validation now passes: both Compose overlays validate, the staging backend and
  frontend start healthy, public Resend-linked routes return HTTP 200, and the encrypted backup
  restore check preserves users, workspaces, memberships, cards, activities and notifications
  (`integrity=ok`, with the disposable staging fixture retaining 2 notifications).
- Headless Chrome screenshots for the desktop dashboard, onboarding, narrow card drawer and Ask
  Kobi states are captured in `docs/VISUAL_QA.md`; the dashboard server/client boundary issue
  found during this pass was fixed. The repeatable CDP smoke reports named controls, keyboard
  traversal, Escape drawer close and a real read-only AI response. The final responsive matrix
  covers 1440px, 768px and 375px widths, reports zero horizontal overflow and zero axe-core
  violations across light/dark states. Human screen-reader review is still open.
- The independent security review remains open. Internal review findings are recorded in
  `docs/SECURITY_REVIEW.md`, but that document explicitly does not substitute for an external
  reviewer. `docs/SECURITY_REVIEW_PACKET.md` provides the scoped handoff and sign-off record.
- Final canonical verification, 2026-10-08: `./scripts/verify.sh` -> `VERIFY: PASS` with **247
  backend tests**, Ruff, frontend lint and TypeScript. The base development Compose services were
  rebuilt and stopped after the run; no staging data was used by the verifier.
- Security review: invitation, verification and password-recovery routes are explicitly public so
  Resend links work for signed-out users; all mutation/API surfaces remain protected by the proxy
  session and backend bearer-token checks.
- Secret verification: redacted `gitleaks detect` scan completed with no leaks found in repository
  history. Production dependency audit is clean; the remaining development-only lint-chain finding
  is documented in `docs/SECURITY_REVIEW.md`.
