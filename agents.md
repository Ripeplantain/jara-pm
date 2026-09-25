# AGENTS.md - Kobi (Kanban MVP)

You are working on a Kanban board MVP with built-in AI features. Users manage boards, columns, and cards by hand; an AI assistant can also create boards, edit them, and move cards on the user's behalf.

Inspect the existing code before changing it, implement directly, verify, and report what you did and what you could not verify.

This file holds project-wide rules. Area-specific rules live next to the code; read the one for the area you are changing:

- [backend/agents.md](backend/agents.md): FastAPI, SQLite, AI tools
- [frontend/agents.md](frontend/agents.md): Next.js UI, NextAuth, drag and drop, AI chat panel

The build plan is in [docs/plan.md](docs/plan.md). Read it before scope-sensitive work and keep it current as phases finish.

## Product Scope

- Boards contain **columns**; columns contain **cards**. Columns are user-editable: create, rename, reorder, delete.
- Cards can be created, edited, reordered within a column, and moved across columns.
- The AI assistant can **create boards** (with suggested columns and starter cards), **edit** boards/columns/cards, and **move** cards.
- Users sign up and sign in with **email and password**. Each user sees and edits only their own boards.
- Out of scope for the MVP unless the user says otherwise: board sharing or collaboration, real-time sync, roles, OAuth/social login, password reset and email verification, comments, attachments, notifications, integrations. Do not build them speculatively.

## Repo Layout

```
frontend/            Next.js app (has its own agents.md)
backend/             FastAPI app (has its own agents.md)
docs/plan.md         Build plan and phase status
.env                 Local secrets (gitignored; never commit or print values)
docker-compose.yml   Dev stack: frontend + backend, SQLite volume
docker-compose.prod.yml  Production override (see README.md)
README.md            Setup and run steps
```

Phases 0-5 are in place: containers, health endpoint, data models, migrations, email/password auth end to end, the board/column/card API, the board UI, the AI assistant, and production images (see README.md). Copy `.env.example` to `.env` and fill the secrets (`openssl rand -base64 32`, a different value for each) before running.

## Stack

- Frontend: Next.js (App Router), TypeScript
- Backend: FastAPI (Python), Pydantic models for all request/response bodies
- Database: SQLite via SQLAlchemy, accessed only by the backend
- Auth: NextAuth (`next-auth`) Credentials provider, email + password; the backend owns users and password hashes
- AI: LLM provider called from the backend only
- Runtime: Docker + Docker Compose

## Non-Negotiable Rules

1. **One path for board mutations.** The UI and the AI change boards through the same backend service functions. No separate "AI path" that touches storage directly.
2. **AI acts through typed tools**, validated before execution. Model output is never executed as code or raw SQL.
3. **LLM keys stay server-side.** The browser never calls the LLM or the database.
4. **AI-proposed changes are validated against real state** (IDs exist and belong together) before being applied.
5. **Destructive AI actions need user confirmation** (deleting a board, column, or cards).
6. **Card order stays consistent.** Moves and reorders are atomic and leave every column with stable, gap-free ordering.
7. **Only the backend touches SQLite.** Never mount the DB volume into the frontend.
8. **Every board, column, and card belongs to a user, and the backend enforces it.** Every endpoint and every AI tool derives the user from the verified auth token, never from a client-supplied user ID, and scopes all queries to that user. A resource owned by someone else looks like a 404.
9. **Passwords are hashed and never exposed.** Store only a strong hash (argon2 or bcrypt), never log or return passwords or hashes, and never put them in AI context.
10. **Auth secrets stay server-side.** `AUTH_SECRET` and the backend's token-signing secret come from `.env`, are different values, and never appear in client code or images.

## Containers

- One `docker-compose.yml` at the repo root defines `frontend` and `backend`; each app has its own `Dockerfile`.
- SQLite lives in a **named Docker volume** mounted into the backend (e.g. `/data/app.db`). Never bake it into an image; never commit `.db` files.
- Config comes from the root `.env` via compose `environment`/`env_file`.
- Inside the compose network the frontend server calls `http://backend:8000`; browser-side calls use the host-published URL. Keep the two distinct.
- Backend has a health endpoint; compose uses it for `healthcheck` and `depends_on`.
- Dev compose mounts source for hot reload. Production images are multi-stage, non-root, with no secrets.

## Commands And Checks

Verified in Phase 0:

- `docker compose up --build` runs the stack (frontend :3000, backend :8000). After changing a Dockerfile or dependencies, add `-V` to renew the anonymous `node_modules`/`.next` volumes.
- Production-style: `docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d` (prod image targets, no mounts, backend not published)
- `docker compose down` stops it (add `-v` only when intentionally wiping the SQLite volume)
- Backend: `docker compose run --rm --no-deps backend sh -c 'pytest -q && ruff check .'`
- Frontend: `docker compose exec frontend npm run lint` and `npm run typecheck`

Do not claim checks passed without stating which command you actually ran.

## Known Pitfalls

- `docker compose down -v` deletes the SQLite volume and all board data; never run it unless the user asks.
- Inside a container, `localhost` is that container. Server-side frontend code must call `http://backend:8000`.

## Assumptions To Confirm

- Migrations use Alembic with SQLAlchemy 2.x (decided in Phase 1; applied automatically when the backend container starts).
- Auth flow (decided in Phase 1, as described): the browser never calls FastAPI; Next.js server code and server actions attach the Bearer token.
- Chosen in Phase 0: npm (Node 22) and pip with pinned `requirements*.txt` (Python 3.13); neither uv nor pnpm/Node is required on the host, everything runs in Docker.
- AI: OpenRouter (OpenAI-compatible API) with a free tool-calling model by default (chosen in Phase 4).
- Drag and drop: `@dnd-kit` (chosen in Phase 3).


## DETAILED PLAN

@docs/PLAN.md