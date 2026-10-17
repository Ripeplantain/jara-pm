import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { initializeDatabase } from '../server/utils/database'
import { users } from '../server/db/schema'

describe('database migrations', () => {
  const databases: Database.Database[] = []

  afterEach(() => {
    for (const database of databases) database.close()
    databases.length = 0
  })

  it('initializes a fresh database and is idempotent across restarts', () => {
    const sqlite = new Database(':memory:')
    databases.push(sqlite)

    const db = initializeDatabase(sqlite)
    db.insert(users).values({
      id: '11111111-1111-4111-8111-111111111111',
      email: 'one@example.test',
      name: 'One',
      passwordHash: 'test-hash',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }).run()

    const restarted = initializeDatabase(sqlite)
    expect(restarted.select({ id: users.id }).from(users).where(eq(users.email, 'one@example.test')).get())
      .toEqual({ id: '11111111-1111-4111-8111-111111111111' })
  })

  it('preserves data in an existing SQLite schema during the baseline migration', () => {
    const sqlite = new Database(':memory:')
    databases.push(sqlite)
    sqlite.exec(`
      CREATE TABLE app_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at)
      VALUES ('22222222-2222-4222-8222-222222222222', 'two@example.test', 'Two', 'test-hash',
              '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    `)

    const db = initializeDatabase(sqlite)
    expect(db.select({ name: users.name }).from(users).where(eq(users.email, 'two@example.test')).get())
      .toEqual({ name: 'Two' })
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tasks'").get())
      .toEqual({ name: 'tasks' })
  })
})
