# Kobi

Kobi is a calm, AI-assisted productivity application built entirely with Nuxt 4.

```text
Goal → Project → Milestone → Task
```

Every level is optional: tasks may live in the Inbox and projects may exist without a goal.

## Stack

- Nuxt 4, Vue 3, TypeScript, and Nitro
- SQLite with `better-sqlite3`
- Sealed httpOnly sessions with `nuxt-auth-utils`
- Zod validation for API input and AI output
- OpenAI-compatible Ask Kobi integration with a local fallback planner
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
features and the local planning fallback work without it.

Start Kobi:

```sh
docker compose up --build
```

Open <http://localhost:3000>. SQLite is stored in the `kobi-data` named volume and survives normal
container restarts. Do not run `docker compose down -v` unless you intend to erase it.

## Verification

```sh
./scripts/verify.sh
```

This rebuilds the verification image and runs Nuxt type checking, Vitest, and the production
build. Individual commands are:

```sh
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm test
docker compose run --rm --no-deps app npm run build
```

## Production

Set a strong `NUXT_SESSION_PASSWORD`, then run:

```sh
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
```

The production image is multi-stage, runs as a non-root user, contains only Nuxt's generated
`.output`, and binds port 3000 to loopback by default. Put a TLS reverse proxy in front of it.

## Security model

- Passwords use scrypt hashing.
- Sessions are sealed, httpOnly, same-site cookies and are checked against the current user row.
- Database reads and writes are scoped by the session user ID.
- AI keys and retrieved context remain server-side.
- AI plans create nothing until explicit acceptance, then persist in one transaction.
