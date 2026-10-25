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

// `KobiDb` is a union, so `.transaction` needs a cast to call. better-sqlite3 implements nested
// transactions as SAVEPOINTs, so this is safe when `db` is already a transaction.
export const withTransaction = <T>(db: KobiDb, run: (tx: KobiDb) => T): T =>
  (db as KobiDatabase).transaction(tx => run(tx)) as T
