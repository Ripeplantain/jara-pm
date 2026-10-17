# ADR 0001: Drizzle ORM with SQLite

- Status: Accepted
- Date: 2026-10-17

## Decision

Kobi uses Drizzle ORM with SQLite through `better-sqlite3`.

Production runs the SQLite file at `/data/kobi.db`, persisted by the Docker `kobi-data` volume.
Drizzle schemas and versioned migrations live in `server/db/` and `drizzle/`. Migrations are
applied when the Nitro server opens the database. The application remains the only process that
accesses SQLite.

## Why

Kobi is currently a single Nuxt application running on one VPS. Keeping the database on the same
machine avoids an additional service, network dependency, and database administration overhead.
SQLite is sufficient for the current workload, while Drizzle provides typed schema definitions,
query building, and migration history.

## Alternatives considered

- Raw SQL with `better-sqlite3`: replaced because schema, query, and migration maintenance were
  becoming manual.
- PostgreSQL in Docker on the VPS: deferred until Kobi needs more write concurrency, multiple app
  instances, background workers, or independent database operations.
- A free managed database: not selected for primary production because free-tier limits, pausing,
  retention, and provider dependency are unsuitable for the system of record.

## Consequences

Positive:

- No separate production database service to operate.
- Fast local access and simple deployment.
- Typed database access and versioned schema changes.
- Existing SQLite data can be migrated without deleting the named volume.

Costs and risks:

- SQLite permits only one writer at a time.
- The VPS and its disk remain a single failure domain.
- Backups must be copied off the VPS and tested independently.
- Schema changes must be shipped with their Drizzle migrations.

## Revisit when

Reconsider self-hosted or managed PostgreSQL when Kobi requires multiple application replicas,
high write concurrency, queue workers sharing the database, remote database clients, or stronger
availability and backup guarantees than the VPS can provide.
