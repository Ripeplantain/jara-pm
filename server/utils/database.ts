import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import type { H3Event } from 'h3'
import { createDatabase, type KobiDatabase } from '~~/server/db'

let database: KobiDatabase | undefined

const migrationsFolder = resolve(process.cwd(), 'drizzle')

export const initializeDatabase = (sqlite: Database.Database) => {
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('busy_timeout = 5000')

  const db = createDatabase(sqlite)
  migrate(db, { migrationsFolder })
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
