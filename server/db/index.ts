import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { schema } from '~~/server/db/schema'

export const createDatabase = (sqlite: Database.Database) => drizzle(sqlite, { schema })

export type KobiDatabase = BetterSQLite3Database<typeof schema>
export type KobiTransaction = Parameters<KobiDatabase['transaction']>[0] extends (tx: infer T) => unknown
  ? T
  : never
export type KobiDb = KobiDatabase | KobiTransaction
