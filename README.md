# Kobi

A containerized product-management app built around shared Kanban boards. Teams work in
workspaces with real roles; an AI assistant can do most of what a person can, through the same
code and the same permission checks.

- **Frontend:** Next.js (App Router), NextAuth email/password sessions, `@dnd-kit` drag and drop
- **Backend:** FastAPI, SQLAlchemy 2 + SQLite, Alembic migrations, argon2 password hashes
- **AI:** any OpenAI-compatible API, OpenRouter by default, called from the backend only
- **Runtime:** Docker Compose. Everything runs in containers; Node and Python are not needed on the host.

## What it does

**Workspaces and people.** A workspace holds boards, labels and members. Invite by email -
someone with an account joins immediately, someone without one gets an invitation they redeem by
signing up. Four roles:

| | viewer | member | admin | owner |
|---|:--:|:--:|:--:|:--:|
| Read everything in the workspace | ● | ● | ● | ● |
| Create and edit boards, columns, cards, sprints | | ● | ● | ● |
| Create and attach labels, comment | | ● | ● | ● |
| Invite, remove and re-role people; rename the workspace | | | ● | ● |
| Rename or delete labels | | | ● | ● |
| Delete the workspace, change another owner | | | | ● |

Nobody can grant a role above their own, and a workspace always keeps at least one owner.

**Boards.** Many per workspace, with favourites, search, and five templates to start from
(Kanban, Scrum, Bug triage, Content calendar, Product roadmap). Columns carry an optional
work-in-progress limit (a warning, never a block) and a "done" flag.

**Cards.** Assignee, priority, due date, estimate, labels, a checklist, comments and history, in
a drawer that deep-links at `/boards/{id}?card={cardId}`. Archive is the reversible way to clear
a card; delete is still there for good.

**Planning.** Sprints with a goal, a progress bar, and one decision when you finish one: where
the unfinished work goes.

**Insights.** Per board: where the work sits, throughput per week, average cycle time, workload
per person, overdue and due-soon counts. "My work" gathers everything assigned to you across the
workspace, grouped by how soon it is due.

**Keeping up.** Every change is recorded in an append-only activity feed, and you are notified
when someone assigns you a card, mentions you with `@name`, or finishes something of yours - never
about your own actions.

**The assistant.** It can create and edit boards and cards, set assignees, priorities, due dates
and estimates, add labels and checklist items, comment, archive, run sprints, and answer "what is
blocked?" from the same numbers the insights page shows. It works through typed tools and the
same service functions the UI uses, so a viewer's assistant can read the board and change nothing.
Deletions are only ever proposed; you confirm them.

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
| `RESEND_API_KEY` | Optional during the beta until email flows are enabled; server-side Resend API key |
| `RESEND_FROM_EMAIL` | Verified Resend sender, for example `Kobi <updates@example.com>` |
| `RESEND_REPLY_TO` | Optional Reply-To address for transactional messages |
| `DATABASE_PATH`, `FRONTEND_ORIGIN`, `AUTH_URL`, `BACKEND_INTERNAL_URL` | Defaults in `.env.example` work locally |

`.env` is gitignored. Never commit it.

## Run

Unauthenticated visitors start at the public Kobi landing page (`/welcome`). The authenticated
app remains separate from marketing pages; privacy and terms are available without an account.

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

Open http://localhost:3000, sign up, and create a board. Signing up also creates your personal
workspace. To see the app with data in it, load the demo workspace:

```sh
docker compose exec backend python -m app.seed
```

It prints the two accounts it creates and their password. It refuses to touch a database that
already has those accounts, so it is safe to re-run. Set `AUTH_URL` (and `FRONTEND_ORIGIN`) to
the public URL when deploying somewhere other than localhost, and put HTTPS in front of the frontend.

Stop with `docker compose down` (add the same `-f` flags for the production stack).

## Your data

SQLite lives in the named volume `jara-pm_db-data`, mounted into the backend at `/data`.
It survives `docker compose down` and `up`. **`docker compose down -v` deletes it and all boards.**
Migrations run automatically when the backend starts. Run a single backend replica with a single
worker: SQLite is single-writer.

To back up:

```sh
./scripts/backup.sh
./scripts/restore-check.sh backups/kobi-YYYYMMDDTHHMMSSZ.db
```

See [docs/OPERATIONS.md](docs/OPERATIONS.md) for the staging/production deployment, backup,
restore, monitoring and rollback runbook. See [docs/AI_MVP.md](docs/AI_MVP.md) for the AI contract,
confirmation model and evaluation scenarios.

## Checks

```sh
./scripts/verify.sh
```

That is the one command that decides whether the tree is good: backend tests and lint, frontend
lint and types. It prefers Docker and falls back to host toolchains (a `backend/.venv`, and Node
from nvm) when the Docker daemon is not running. Individually:

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
- Everything hangs off a workspace, and access comes from membership in it. The backend scopes
  every query through `workspace_members` and answers 404 for a workspace you are not in, 403 for
  an action your role does not allow. `backend/app/services/permissions.py` is the only place
  that decides this.
- The UI and the AI change things through the same service functions, and the permission checks
  live in those functions rather than in the HTTP layer - which is what makes the AI tools safe
  rather than merely well-prompted.
- AI tools are typed, validated against the real board, and deletions only happen after the user
  confirms. The model is sent ids and display names, never email addresses or credentials.
- Activity and notifications are written inside the same transaction as the change they describe,
  so a rejected change leaves no trace and an AI edit looks exactly like a human one.

See [docs/PLAN.md](docs/PLAN.md) for the build plan and the decisions behind it, and the
`agents.md` files for project rules. [PROMPT.md](PROMPT.md) and `scripts/ralph.sh` are the
self-running build loop that produced phases 6-14.

## Troubleshooting

- **`attempt to write a readonly database`:** the data volume is owned by a different user than the
  container's. Both images use the same `app` user; if you changed that, `chown` the volume.
- **Assistant says it is not configured:** `LLM_API_KEY` is empty in `.env`; restart the backend after setting it.
- **Assistant errors or ignores tools:** the free model may be down or unable to call tools; set `LLM_MODEL`.
- **"This action needs a member role":** your role in the active workspace is `viewer`. An admin
  can change it on the Members page.
- **A board is missing after switching workspaces:** boards belong to one workspace. The switcher
  in the header changes which one you are looking at.
