# AGENTS.md - Backend (FastAPI)

Kobi API, persistence, and AI orchestration. Read the root [agents.md](../agents.md) first; its
non-negotiable rules apply here.

Built so far (phases 0-13): auth and profiles, workspaces and membership with roles,
invitations, boards in workspaces, rich cards (assignee, priority, due date, estimate, labels,
checklist, comments, archive), sprints, column settings, filtering and search, board templates,
favourites, an append-only activity log, notifications, analytics, and an AI tool set that
covers all of it. `docs/PLAN.md` records what each phase decided and why.

## Intended Structure

```
backend/
  app/
    main.py        FastAPI app, CORS, router registration
    routers/       Thin HTTP layer (auth, workspaces, boards, sprints, notifications, ai, health)
    services/      Business logic; the ONLY code that mutates data
      permissions.py  Who may do what. Every other service calls it.
      errors.py       NotFound / Forbidden / Conflict / InvalidRequest, mapped in main.py
      activity.py     The append-only log, written inside the mutating transaction
      notifications.py  In-app notifications, written the same way
    models/        SQLAlchemy models (User, Workspace, WorkspaceMember, WorkspaceInvite,
                   Board, BoardFavorite, Column, Card, Label, CardLabel, ChecklistItem,
                   Comment, Sprint, Activity, Notification)
    auth/          Password hashing, token issue/verify, current-user dependency
    schemas/       Pydantic request/response models
    util/time.py   as_utc(): SQLite returns naive datetimes; compare through this
    ai/            Tool definitions, prompt/context builder, LLM client
  migrations/      Schema migrations
  Dockerfile
```

## Rules

- **Routers stay thin.** Parse input, call a service function, return the result. No business logic or SQL in routers.
- **Services are shared by the UI API and AI tools.** An AI tool such as `move_card` must call the same service function as the `PATCH` endpoint. Never duplicate mutation logic.
- **Every request/response body is a Pydantic schema.** Mutations return the updated resource(s).
- **Use proper status codes** (404 unknown ID, 409 conflict, 422 validation) and structured error bodies. The AI tool loop receives these errors as tool results.
- Enable CORS only for the frontend's origin.
- Provide a health endpoint used by compose.
- Transactional email uses Resend through a backend service adapter. Keep `RESEND_API_KEY` out of
  responses, logs, AI context, tests, and frontend environment variables.

## Auth, Membership And Roles

- The backend owns users. `User` has a unique, normalized (lowercased, trimmed) email and a password hash. Hash with argon2 or bcrypt; never store, log, or return plaintext passwords or hashes.
- Endpoints: sign-up (`POST /api/auth/register`) and login (`POST /api/auth/login`). Login is called by NextAuth's `authorize()`; it verifies the password and returns a short-lived signed JWT plus basic user info. Use a generic "invalid credentials" error for both unknown email and wrong password.
- A `get_current_user` FastAPI dependency verifies the Bearer token on every non-public route.
  Register, login, invite preview, email verification, password reset request/reset and health
  are the deliberately public API surfaces; all workspace and mutation routes require a token.
- The signing secret comes from an env var and is not the same value as NextAuth's `AUTH_SECRET`.
- **Membership decides access; role decides the action.** `Board` has `workspace_id`;
  `created_by_id` is provenance only and grants nothing. Services take the current user and scope
  every query through `workspace_members`, reaching columns and cards through their board. Never
  accept a user id from the request body or query.
- `services/permissions.py` is the single gate: `require_workspace / require_board /
  require_column / require_card`, each taking a minimum role. A workspace the user is not in
  raises `NotFound` (404); a role too weak raises `Forbidden` (403). The distinction is
  deliberate - a non-member must not learn that the resource exists.
- **The checks live in the service layer, not the router.** That is what makes the AI tools safe:
  they call the same functions, so a viewer's assistant gets the same 403 the HTTP API would.
- Two guard rails: nobody grants a role above their own, and a workspace keeps at least one
  owner. Both live in `services/workspaces.py`.
- Registration creates the user, their personal workspace, and any pending invitations for that
  address, in one transaction.
- Validate email format and a minimum password length in the Pydantic schema. Rate limiting and lockout are out of scope for the MVP.

## SQLite And SQLAlchemy

- Use SQLAlchemy 2.x style (`Mapped`, `mapped_column`, `select()`), with a session-per-request dependency. Do not use the legacy `Query` API.
- DB path comes from an env var and points into the mounted volume (e.g. `/data/app.db`).
- Set `PRAGMA foreign_keys=ON` on every connection; consider WAL mode.
- SQLite is single-writer: run a single uvicorn worker and a single replica.
- Wrap each mutation that touches multiple rows (moves, reorders, column deletes, board creation) in one transaction.
- Schema changes go through migrations, not `create_all` against an existing database.
- Position handling: contiguous integers 0..n-1 per parent (decided in Phase 2), renumbered in the mutation's transaction. Sessions use `expire_on_commit=False`, so service lookups use `populate_existing` to avoid stale collections. Moving a card updates its column and position and closes the gap it left, atomically. Archived cards are out of the ordering entirely, which is what keeps visible positions contiguous.
- Deleting a column must not orphan cards: require moving them or an explicit confirmation to delete them.
- `completed_at` is set by moving a card into a column flagged `is_done`, never by a field write,
  so cycle time cannot be faked. Marking a column done re-syncs the cards already in it.
- **Migration hazard.** Batch mode rebuilds a table by dropping it; with foreign keys enforced
  that cascades to child rows. `migrations/env.py` opens the migration engine with
  `enforce_foreign_keys=False`. A migration that rebuilds a table needs a test that seeds child
  rows first - see `test_migration_0003_keeps_columns_and_cards`.
- SQLite stores datetimes without a timezone, so a value read back is naive while one still in
  the session is aware. Comparing them raises: go through `app/util/time.py:as_utc`.

## Activity And Notifications

- `activity.record(...)` and `notifications.notify(...)` are called **inside** the mutating
  service function, before its commit. History and the change land together, so a rejected change
  records nothing (tested), and an AI edit is identical to a human one but for `actor_id`.
- Activity is append-only: never updated, never deleted, and `board_id`/`card_id` are plain
  integers rather than cascading foreign keys so history outlives what it describes.
- Nobody is notified about their own action.

## AI Orchestration

- Tools cover boards, columns, cards, card fields, labels, checklists, comments, archiving,
  sprints, templates and read-only `board_stats`. Each has a Pydantic argument schema.
- Validate that all referenced IDs exist and are consistent (card belongs to the stated board, target column is on the same board) before calling the service. On failure, return an error result to the model; do not guess.
- Delete tools do not execute directly: they return a pending-confirmation result that the frontend surfaces to the user.
- AI tools run as the authenticated user and go through the same permission-checked services; a
  tool can never reach a board the user cannot, and a viewer's tool call gets a `Forbidden` turned
  into a readable tool error. **The prompt is never the enforcement.**
- Archiving is reversible, so `archive_card` runs immediately; the delete tools still only propose.
- Build context per request from the board state, plus the workspace's members, labels, sprints
  and template keys, and the acting user's role. **Ids and display names only** - never emails,
  hashes or tokens (tested in `tests/test_ai_tools.py`).
- Use the provider's tool-calling; cap loop iterations.
- The AI endpoint returns the assistant's reply plus the list of applied changes, so the UI can update and show them.
- Model name and provider are configuration. The LLM key is read from the environment and never logged or returned.
- Log tool calls and results for debugging; not secrets.

## Testing

- Test the service layer directly, including position invariants after moves and reorders, and column deletion with cards.
- Test permissions at the level that enforces them: a viewer calling a service function must
  raise `Forbidden`, not merely be hidden by the UI. `tests/test_permissions.py` and the viewer
  cases in `tests/test_ai_tools.py` are the pattern to copy for any new write.
- A migration that rebuilds a table gets a test that seeds child rows and asserts they survive.
- Test each AI tool with valid and invalid IDs, using a fake LLM client; no tests call a real provider.
- Test auth: register, login, wrong password, duplicate email, missing or invalid token, and that user A gets 404 on user B's board, column, and card, including through AI tools.
- Use a temporary SQLite database per test.
- Test and lint (pytest, ruff; run from the repo root): `docker compose run --rm --no-deps backend sh -c 'pytest -q && ruff check .'`. Dev deps are in `requirements-dev.txt`; tests use `httpx2` via FastAPI's `TestClient`.

## Assumptions To Confirm

- Decided in Phase 1: Alembic (autogenerate, `render_as_batch`; the container runs `alembic upgrade head` on start), argon2-cffi, PyJWT (HS256, `ACCESS_TOKEN_MINUTES`, default 60). Create a migration with `docker compose run --rm --no-deps -e DATABASE_PATH=/tmp/gen.db backend alembic revision --autogenerate -m "..."`.
- Tests run migrations on a temp DB per test (`tests/conftest.py`), so schema changes need a migration to pass.
- `BACKEND_JWT_SECRET` (>= 32 chars) is required; there is no default.
- The Dockerfile has `dev` and `prod` targets (Phase 5); prod is multi-stage, non-root (same `app` user as dev, so one volume works with both), no tests or dev deps, one worker. Do not pin a different uid.
- Python tooling is pip with pinned requirements, Python 3.13 (decided in Phase 0).
- Decided in Phase 4: OpenRouter through the `openai` SDK; tests use a scripted fake `LLMClient`
  (the `use_llm` fixture in `tests/conftest.py` overrides the `get_llm_client` dependency).
- Changing a password does not revoke existing access tokens; they expire on their own within
  `ACCESS_TOKEN_MINUTES`. A token store would be needed to do better.
- Search is SQL `LIKE` over title and description, with wildcards escaped. No FTS table yet.

## AI workflow

Project context, rules, and task workflows for AI agents live in `.agent/`.
Start with `.agent/PROJECT.md`.
