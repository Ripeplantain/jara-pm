# Kobi (Kanban MVP)

A containerized Kanban board. Signed-in users manage their own boards, columns and cards, and an
AI assistant can create boards, edit them and move cards on their behalf.

- **Frontend:** Next.js (App Router), NextAuth email/password sessions, `@dnd-kit` drag and drop
- **Backend:** FastAPI, SQLAlchemy 2 + SQLite, Alembic migrations, argon2 password hashes
- **AI:** any OpenAI-compatible API, OpenRouter by default, called from the backend only
- **Runtime:** Docker Compose. Everything runs in containers; Node and Python are not needed on the host.

## Requirements

Docker with Compose v2.24 or newer (the production file uses `!reset` / `!override`).

## Setup

```sh
cp .env.example .env
```

Fill in `.env`:

| Variable | Purpose |
| --- | --- |
| `BACKEND_JWT_SECRET` | Signs backend access tokens. `openssl rand -base64 32` |
| `AUTH_SECRET` | NextAuth secret. A **different** value: `openssl rand -base64 32` |
| `LLM_API_KEY` | Key for the AI assistant ([OpenRouter](https://openrouter.ai/keys)). Optional: without it the assistant answers "not configured" and everything else works |
| `LLM_MODEL` | Optional. Must support tool calling. Defaults to a free OpenRouter model, which may change or be rate limited |
| `LLM_BASE_URL` | Optional. Any OpenAI-compatible endpoint |
| `DATABASE_PATH`, `FRONTEND_ORIGIN`, `AUTH_URL`, `BACKEND_INTERNAL_URL` | Defaults in `.env.example` work locally |

`.env` is gitignored. Never commit it.

## Run

**Development** (source mounted, hot reload; frontend on :3000, backend on :8000):

```sh
docker compose up --build
```

After changing a Dockerfile or dependencies, add `-V` to renew the anonymous `node_modules` and
`.next` volumes.

**Production-style** (multi-stage, non-root images; no source mounts; backend not published to the host):

```sh
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
```

Open http://localhost:3000, sign up, and create a board. Set `AUTH_URL` (and `FRONTEND_ORIGIN`) to
the public URL when deploying somewhere other than localhost, and put HTTPS in front of the frontend.

Stop with `docker compose down` (add the same `-f` flags for the production stack).

## Your data

SQLite lives in the named volume `product-manager_db-data`, mounted into the backend at `/data`.
It survives `docker compose down` and `up`. **`docker compose down -v` deletes it and all boards.**
Migrations run automatically when the backend starts. Run a single backend replica with a single
worker: SQLite is single-writer.

To back up:

```sh
docker compose exec backend python -c "import sqlite3; s=sqlite3.connect('/data/app.db'); d=sqlite3.connect('/data/backup.db'); s.backup(d)"
docker compose cp backend:/data/backup.db ./backup.db
```

## Checks

```sh
# Backend tests and lint
docker compose run --rm --no-deps backend sh -c 'pytest -q && ruff check .'

# Frontend lint, types, build (next typegen generates the route types)
docker compose run --rm --no-deps frontend sh -c 'npx next typegen && npm run typecheck && npm run lint && npm run build'
```

There are no frontend tests yet. Backend tests use a temporary SQLite database per test and a fake
LLM client; none call a real provider.

## How it fits together

- The browser never talks to FastAPI or the database. Server components and a same-origin proxy
  (`frontend/app/api/backend`) forward requests with the access token from the httpOnly session cookie.
- Every board, column and card belongs to a user; the backend scopes every query to the token's user
  and answers 404 for anything owned by someone else.
- The UI and the AI change boards through the same service functions (`backend/app/services/boards.py`).
  AI tools are typed, validated against the real board, and deletions only happen after the user confirms.

See [docs/plan.md](docs/plan.md) for the build plan and decisions, and the `agents.md` files for
project rules.

## Troubleshooting

- **`attempt to write a readonly database`:** the data volume is owned by a different user than the
  container's. Both images use the same `app` user; if you changed that, `chown` the volume.
- **Assistant says it is not configured:** `LLM_API_KEY` is empty in `.env`; restart the backend after setting it.
- **Assistant errors or ignores tools:** the free model may be down or unable to call tools; set `LLM_MODEL`.
