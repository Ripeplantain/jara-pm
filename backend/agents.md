# AGENTS.md - Backend (FastAPI)

Kobi API, persistence, and AI orchestration for the Kanban MVP. Read the root [agents.md](../agents.md) first; its non-negotiable rules apply here.

Built so far: app config, DB engine/session (`app/db.py`), models for all four tables, auth (hashing, tokens, `get_current_user`), the auth/health/`/api/me` routers, and the initial migration. Phase 2 added `services/boards.py` (all board/column/card mutations), `routers/boards.py` and `schemas/boards.py`; Phase 4 added `ai/` (`llm.py` provider adapter, `tools.py`, `context.py`, `agent.py`), `routers/ai.py` and `schemas/ai.py`.

## Intended Structure

```
backend/
  app/
    main.py        FastAPI app, CORS, router registration
    routers/       Thin HTTP layer (auth, boards, columns, cards, ai, health)
    services/      Business logic; the ONLY code that mutates data
    models/        SQLAlchemy models (User, Board, Column, Card)
    auth/          Password hashing, token issue/verify, current-user dependency
    schemas/       Pydantic request/response models
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

## Auth And Ownership

- The backend owns users. `User` has a unique, normalized (lowercased, trimmed) email and a password hash. Hash with argon2 or bcrypt; never store, log, or return plaintext passwords or hashes.
- Endpoints: sign-up (`POST /api/auth/register`) and login (`POST /api/auth/login`). Login is called by NextAuth's `authorize()`; it verifies the password and returns a short-lived signed JWT plus basic user info. Use a generic "invalid credentials" error for both unknown email and wrong password.
- A `get_current_user` FastAPI dependency verifies the Bearer token on every non-public route. Only register, login, and health are public.
- The signing secret comes from an env var and is not the same value as NextAuth's `AUTH_SECRET`.
- `Board` has `owner_id` (foreign key to `User`). Services take the current user and scope every query by ownership, reaching columns and cards through their board. Never accept a user ID from the request body or query.
- Unauthorized access to another user's resource returns 404, not 403.
- Validate email format and a minimum password length in the Pydantic schema. Rate limiting and lockout are out of scope for the MVP.

## SQLite And SQLAlchemy

- Use SQLAlchemy 2.x style (`Mapped`, `mapped_column`, `select()`), with a session-per-request dependency. Do not use the legacy `Query` API.
- DB path comes from an env var and points into the mounted volume (e.g. `/data/app.db`).
- Set `PRAGMA foreign_keys=ON` on every connection; consider WAL mode.
- SQLite is single-writer: run a single uvicorn worker and a single replica.
- Wrap each mutation that touches multiple rows (moves, reorders, column deletes, board creation) in one transaction.
- Schema changes go through migrations, not `create_all` against an existing database.
- Position handling: contiguous integers 0..n-1 per parent (decided in Phase 2), renumbered in the mutation's transaction. Sessions use `expire_on_commit=False`, so service lookups use `populate_existing` to avoid stale collections. Moving a card updates its column and position and closes the gap it left, atomically.
- Deleting a column must not orphan cards: require moving them or an explicit confirmation to delete them.

## AI Orchestration

- Expose a fixed set of tools, for example: create_board, add_column, rename_column, reorder_columns, delete_column, create_card, update_card, move_card, delete_card. Each has a Pydantic argument schema.
- Validate that all referenced IDs exist and are consistent (card belongs to the stated board, target column is on the same board) before calling the service. On failure, return an error result to the model; do not guess.
- Delete tools do not execute directly: they return a pending-confirmation result that the frontend surfaces to the user.
- AI tools run as the authenticated user and go through the same ownership-scoped services; a tool can never reach another user's board.
- Build context per request from the current user's board state (columns and cards with IDs), trimmed to what is needed. Never include user emails or credentials.
- Use the provider's tool-calling; cap loop iterations.
- The AI endpoint returns the assistant's reply plus the list of applied changes, so the UI can update and show them.
- Model name and provider are configuration. The LLM key is read from the environment and never logged or returned.
- Log tool calls and results for debugging; not secrets.

## Testing

- Test the service layer directly, including position invariants after moves and reorders, and column deletion with cards.
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
- Decided in Phase 4: OpenRouter through the `openai` SDK; tests use a scripted fake `LLMClient` (override the `get_llm_client` dependency).
