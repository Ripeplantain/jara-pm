# Kobi

Kobi is a calm, AI-assisted productivity application built entirely with Nuxt 4.

```text
Goal → Project → Milestone → Task
```

Every level is optional: tasks may live in the Inbox and projects may exist without a goal.

## Stack

- Nuxt 4, Vue 3, TypeScript, and Nitro
- SQLite with `better-sqlite3` and Drizzle ORM
- Sealed httpOnly sessions with `nuxt-auth-utils`
- Zod validation for API input and AI output
- OpenRouter-backed Ask Kobi integration with a local fallback planner
- Docker Compose for development, staging, and production

The complete application lives at the repository root. Nitro is the only API and the only process
that accesses SQLite.

## Setup

Create the local environment file and generate a session password:

```sh
cp .env.example .env
openssl rand -base64 32
```

Put the generated value in `NUXT_SESSION_PASSWORD`. `NUXT_LLM_API_KEY` is optional; all manual
features and the local planning fallback work without it. Ask Kobi uses one model, set by
`NUXT_LLM_MODEL`; `NUXT_LLM_CHAT_MODEL` and `NUXT_LLM_PLAN_MODEL` were removed and are no longer read, so a
deployment that still sets them silently gets `NUXT_LLM_MODEL` instead.

Start Kobi:

```sh
docker compose up --build
```

Open <http://localhost:3000>. SQLite is stored in the `kobi-data` named volume and survives normal
container restarts. Drizzle applies versioned migrations when Nitro opens the database. Back up
the volume or database file off the VPS before deploying schema changes. Do not run
`docker compose down -v` unless you intend to erase it.

Generate a new migration after changing `server/db/schema.ts`:

```sh
docker compose run --rm --no-deps app npm run db:generate
```

## Verification

```sh
./scripts/verify.sh
```

This rebuilds the verification image and runs Biome lint, Nuxt type checking, Vitest, and the
production build. Individual commands are:

```sh
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run lint:fix
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm test
docker compose run --rm --no-deps app npm run build
```

### Pre-push hook

`git config core.hooksPath .githooks` enables `scripts/pre-push.sh`, which runs only lint,
type checking, and tests against the working tree. It takes seconds and performs no image or
Nuxt build. The production build, production image, and health smoke test run in
`.github/workflows/deploy.yml` on pull requests and pushes to `main`; the deploy job will not
run unless they pass. Use `git push --no-verify` to bypass the hook, or `./scripts/verify.sh`
to run the full gate locally.

Biome lints the `<script>` blocks of `.vue` files using its stable legacy handling, so the
template and style blocks are not linted. The formatter is disabled; Biome is used only as a
linter here.

## Production

Set a strong `NUXT_SESSION_PASSWORD`, then run:

```sh
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
```

The production image is multi-stage, runs as a non-root user, contains Nuxt's generated `.output`
plus the checked-in Drizzle migrations, and binds port 3000 to loopback by default. Put a TLS
reverse proxy in front of it.

The database and ORM choice is documented in [ADR 0001](docs/decisions/database_decision.md).

## Security model

- Passwords use scrypt hashing.
- Sessions are sealed, httpOnly, same-site cookies and are checked against the current user row.
- Database reads and writes are scoped by the session user ID.
- AI keys and retrieved context remain server-side.
- AI plans create nothing until explicit acceptance, then persist in one transaction.
