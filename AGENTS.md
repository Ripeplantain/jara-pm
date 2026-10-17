# AGENTS.md — Kobi

Kobi is a single full-stack Nuxt 4 application. Nuxt owns the Vue UI, Nitro API, authentication,
business services, SQLite access, and AI provider boundary.

## Product

```text
Goal → Project → Milestone → Task
```

Every level is optional. Tasks may remain in the Inbox and projects do not require goals. The
primary navigation is Today, Inbox, Goals, Projects, and Upcoming. Ask Kobi proposes changes and
requires review before persistence.

## Structure

```text
app/                 Vue pages, layouts, components, composables, middleware, and CSS
server/api/          Validated Nitro HTTP handlers
server/services/     User-scoped business logic and transactions
server/utils/        Database and authentication boundaries
server/types/        Server-only database row types
shared/schemas/      Zod request and AI proposal schemas
shared/types/        Client/server response contracts
shared/utils/        Pure shared helpers
tests/               Vitest service and schema tests
```

## Invariants

1. Every private query includes the authenticated user ID.
2. Browser code never reads SQLite, password hashes, session secrets, or AI provider keys.
3. Validate API input and model output with Zod.
4. AI proposals remain inert until explicit acceptance and persist transactionally.
5. Empty goals and projects report unmeasured progress (`null`), not zero.
6. Never delete a database or named volume without explicit approval.
7. Use `<script setup lang="ts">`, strict TypeScript, keyed `useFetch`/`useAsyncData`, and
   `useRuntimeConfig(event)` for server configuration.

## Commands

- Run: `docker compose up --build`
- Typecheck: `docker compose run --rm --no-deps app npm run typecheck`
- Test: `docker compose run --rm --no-deps app npm test`
- Build: `docker compose run --rm --no-deps app npm run build`
- Full verification: `./scripts/verify.sh`

Never read or print `.env` or `.env.nuxt.local`. `.env.example` is safe to update.

## Agent workflow

This repo uses an agent workflow in `.agent/` (agent-workflow 2.0.0).

- Project facts, commands, and invariants: `.agent/PROJECT.md`. Read it first.
- Hard stops: `.agent/rules/checkpoints.md`. These override anything else.
- Roles: `.agent/agents/` (planner, implementer, tester, reviewer, evaluator).
- Workflows: `.agent/workflows/` (feature, fix, prompt-change).

Pick the workflow that matches the task and follow its steps.

## Delegation

When subagents are available, delegate bounded work and ask each to return a summary, not raw output:
- Before a non-trivial change: spawn `planner`.
- After implementation: spawn `tester`, then `reviewer`. For AI prompt or model changes, spawn `evaluator` before `reviewer`.
Without subagents, work through the same roles in order yourself, reading each role doc as you reach that step.
