import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import type { H3Event } from 'h3'
import { createDatabase, type KobiDatabase } from '~~/server/db'

let database: KobiDatabase | undefined

const migrationsFolder = resolve(process.cwd(), 'drizzle')

// Drizzle records every applied migration in this table. Counting before and after `migrate()`
// is how we tell whether anything actually ran, so an already-migrated database does not pay for
// a whole-database integrity scan on every process start.
const appliedMigrationCount = (sqlite: Database.Database): number => {
  try {
    const row = sqlite.prepare('select count(*) as count from __drizzle_migrations').get() as
      | { count: number }
      | undefined
    return Number(row?.count ?? 0)
  } catch {
    // The table does not exist yet on a fresh database.
    return 0
  }
}

export const initializeDatabase = (sqlite: Database.Database) => {
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('busy_timeout = 5000')

  const db = createDatabase(sqlite)
  // better-sqlite3 opens connections with foreign_keys ON, and Drizzle runs every pending
  // migration inside one transaction, where `PRAGMA foreign_keys` is a no-op -- so the pragma
  // statements Drizzle emits inside migration files do nothing. With enforcement left on,
  // SQLite's table-rebuild pattern (DROP + RENAME) fires ON DELETE CASCADE and destroys child
  // rows. `defer_foreign_keys` is not an alternative: it changes when a violation is reported,
  // not whether DROP TABLE fires cascades. Enforcement is therefore disabled around migrate and
  // restored in a `finally`, so a failed migration cannot leave the connection unprotected.
  const before = appliedMigrationCount(sqlite)
  sqlite.pragma('foreign_keys = OFF')
  try {
    migrate(db, { migrationsFolder })
    if (appliedMigrationCount(sqlite) !== before) {
      const violations = sqlite.pragma('foreign_key_check') as unknown[]
      if (violations.length > 0) {
        // Deliberately not thrown. `migrate()` commits its own transaction, so by this point
        // there is nothing left to roll back and the migration is already recorded as applied;
        // throwing would fail this boot and every later one identically, turning a data problem
        // into an unrecoverable startup loop that needs manual SQLite surgery. Reporting loudly
        // leaves the operator an application they can actually get into to repair it.
        console.error(
          `[database] Migration left ${violations.length} foreign key violation(s).`,
          'Run `PRAGMA foreign_key_check` against the database file to see the dangling rows.',
          violations,
        )
      }
    }
  } finally {
    sqlite.pragma('foreign_keys = ON')
  }
  return db
}

export const useDatabase = (event: H3Event) => {
  if (database) return database

  const config = useRuntimeConfig(event)
  const databasePath = resolve(String(config.databasePath))
  mkdirSync(dirname(databasePath), { recursive: true })
  database = initializeDatabase(new Database(databasePath))
  return database
}
