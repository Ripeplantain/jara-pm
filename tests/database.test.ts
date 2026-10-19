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

  it('backfills recurrence as none for tasks from the previous schema', () => {
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
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        project_id TEXT,
        milestone_id TEXT,
        parent_id TEXT,
        title TEXT NOT NULL,
        description TEXT DEFAULT '' NOT NULL,
        status TEXT DEFAULT 'todo' NOT NULL,
        priority TEXT DEFAULT 'none' NOT NULL,
        due_date TEXT,
        scheduled_for TEXT,
        selected_for_today INTEGER DEFAULT false NOT NULL,
        completed_at TEXT,
        position INTEGER DEFAULT 0 NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at)
      VALUES ('33333333-3333-4333-8333-333333333333', 'legacy@example.test', 'Legacy', 'test-hash',
              '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      INSERT INTO tasks (id, user_id, title, created_at, updated_at)
      VALUES ('44444444-4444-4444-8444-444444444444', '33333333-3333-4333-8333-333333333333',
              'Legacy task', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    `)

    initializeDatabase(sqlite)

    expect(sqlite.prepare('SELECT recurrence FROM tasks WHERE id = ?').get('44444444-4444-4444-8444-444444444444'))
      .toEqual({ recurrence: 'none' })
  })
})
