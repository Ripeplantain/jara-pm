import { readFileSync } from 'node:fs'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createDatabase } from '../server/db'
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
      CREATE TABLE ai_messages (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE ai_proposals (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT DEFAULT 'pending' NOT NULL,
        created_at TEXT NOT NULL,
        resolved_at TEXT
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

  it('backfills one workspace per existing user without losing linked data', () => {
    const sqlite = new Database(':memory:')
    databases.push(sqlite)
    sqlite.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE goals (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT DEFAULT '' NOT NULL,
        status TEXT DEFAULT 'active' NOT NULL,
        target_date TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE projects (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        goal_id TEXT,
        title TEXT NOT NULL,
        description TEXT DEFAULT '' NOT NULL,
        status TEXT DEFAULT 'active' NOT NULL,
        target_date TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE milestones (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT DEFAULT '' NOT NULL,
        status TEXT DEFAULT 'active' NOT NULL,
        target_date TEXT,
        position INTEGER DEFAULT 0 NOT NULL,
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
        recurrence TEXT DEFAULT 'none' NOT NULL,
        selected_for_today INTEGER DEFAULT false NOT NULL,
        completed_at TEXT,
        position INTEGER DEFAULT 0 NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE ai_messages (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE ai_proposals (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT DEFAULT 'pending' NOT NULL,
        created_at TEXT NOT NULL,
        resolved_at TEXT
      );
      INSERT INTO users VALUES
        ('legacy-one', 'one@example.test', 'One', 'hash', '2026-01-01', '2026-01-01'),
        ('legacy-two', 'two@example.test', 'Two', 'hash', '2026-01-02', '2026-01-02');
      INSERT INTO goals VALUES ('goal-one', 'legacy-one', 'One goal', '', 'active', NULL, '2026-01-01', '2026-01-01');
      INSERT INTO projects VALUES ('project-one', 'legacy-one', 'goal-one', 'One project', '', 'active', NULL, '2026-01-01', '2026-01-01');
      INSERT INTO milestones VALUES ('milestone-one', 'legacy-one', 'project-one', 'One milestone', '', 'active', NULL, 0, '2026-01-01', '2026-01-01');
      INSERT INTO tasks VALUES ('task-one', 'legacy-one', 'project-one', 'milestone-one', NULL, 'One task', '', 'todo', 'none', NULL, NULL, 'none', 1, NULL, 0, '2026-01-01', '2026-01-01');
      INSERT INTO tasks VALUES ('inbox-two', 'legacy-two', NULL, NULL, NULL, 'Two inbox', '', 'todo', 'none', NULL, NULL, 'none', 0, NULL, 0, '2026-01-02', '2026-01-02');
      INSERT INTO ai_messages VALUES ('message-one', 'legacy-one', 'user', 'Legacy message', '2026-01-01');
      INSERT INTO ai_proposals VALUES ('proposal-one', 'legacy-one', 'goal_plan', '{}', 'pending', '2026-01-01', NULL);
    `)

    const priorMigration = [
      readFileSync('drizzle/0002_worried_talon.sql', 'utf8'),
      readFileSync('drizzle/0003_slim_killraven.sql', 'utf8'),
    ].join('--> statement-breakpoint')
    sqlite.exec('BEGIN')
    for (const statement of priorMigration.split('--> statement-breakpoint')) {
      if (statement.trim()) sqlite.exec(statement)
    }
    expect(sqlite.prepare('SELECT selected_for_today FROM tasks WHERE id = ?').get('task-one'))
      .toEqual({ selected_for_today: 1 })
    const migration = readFileSync('drizzle/0004_charming_shatterstar.sql', 'utf8')
    for (const statement of migration.split('--> statement-breakpoint')) {
      if (statement.trim()) sqlite.exec(statement)
    }
    sqlite.exec('COMMIT')

    const workspaces = sqlite.prepare('SELECT id, name, owner_id FROM workspaces ORDER BY owner_id').all() as Array<{ id: string, name: string, owner_id: string }>
    expect(workspaces).toHaveLength(2)
    expect(workspaces.map(row => row.name)).toEqual(["One's workspace", "Two's workspace"])
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM workspace_members WHERE role = \'owner\'').get()).toEqual({ count: 2 })

    const workspaceByOwner = new Map(workspaces.map(row => [row.owner_id, row.id]))
    for (const [userId, workspaceId] of workspaceByOwner) {
      expect(sqlite.prepare('SELECT active_workspace_id FROM users WHERE id = ?').get(userId))
        .toEqual({ active_workspace_id: workspaceId })
    }
    expect(sqlite.prepare('SELECT workspace_id FROM goals WHERE id = ?').get('goal-one'))
      .toEqual({ workspace_id: workspaceByOwner.get('legacy-one') })
    expect(sqlite.prepare('SELECT workspace_id FROM projects WHERE id = ?').get('project-one'))
      .toEqual({ workspace_id: workspaceByOwner.get('legacy-one') })
    expect(sqlite.prepare('SELECT workspace_id FROM milestones WHERE id = ?').get('milestone-one'))
      .toEqual({ workspace_id: workspaceByOwner.get('legacy-one') })
    expect(sqlite.prepare('SELECT workspace_id FROM tasks WHERE id = ?').get('task-one'))
      .toEqual({ workspace_id: workspaceByOwner.get('legacy-one') })
    expect(sqlite.prepare('SELECT workspace_id FROM tasks WHERE id = ?').get('inbox-two'))
      .toEqual({ workspace_id: workspaceByOwner.get('legacy-two') })
    expect(sqlite.prepare('SELECT goal_id FROM projects WHERE id = ?').get('project-one'))
      .toEqual({ goal_id: 'goal-one' })
    expect(sqlite.prepare('SELECT project_id, milestone_id FROM tasks WHERE id = ?').get('task-one'))
      .toEqual({ project_id: 'project-one', milestone_id: 'milestone-one' })
    expect(sqlite.prepare('SELECT user_id, task_id FROM task_day_selections').all())
      .toEqual([{ user_id: 'legacy-one', task_id: 'task-one' }])
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM pragma_table_info('tasks') WHERE name = 'selected_for_today'").get())
      .toEqual({ count: 0 })
    expect(sqlite.prepare('SELECT assignee_id FROM tasks WHERE id = ?').get('task-one'))
      .toEqual({ assignee_id: null })
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM milestones WHERE id = ?').get('milestone-one'))
      .toEqual({ count: 1 })
    expect(sqlite.prepare('SELECT workspace_id FROM ai_messages WHERE id = ?').get('message-one'))
      .toEqual({ workspace_id: workspaceByOwner.get('legacy-one') })
    expect(sqlite.prepare('SELECT workspace_id FROM ai_proposals WHERE id = ?').get('proposal-one'))
      .toEqual({ workspace_id: workspaceByOwner.get('legacy-one') })

    const db = createDatabase(sqlite)
    expect(db.select({ id: users.id }).from(users).all()).toHaveLength(2)
  })
})
