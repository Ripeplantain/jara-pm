import { readdirSync, readFileSync } from 'node:fs'
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

  // Migrations run with foreign_keys OFF so the table-rebuild pattern does not cascade child
  // rows away. The application must never be left running in that state.
  it('leaves foreign key enforcement on after migrating', () => {
    const sqlite = new Database(':memory:')
    databases.push(sqlite)

    initializeDatabase(sqlite)

    expect(sqlite.pragma('foreign_keys')).toEqual([{ foreign_keys: 1 }])
    // And again on a database that has nothing left to migrate.
    initializeDatabase(sqlite)
    expect(sqlite.pragma('foreign_keys')).toEqual([{ foreign_keys: 1 }])
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

  it('backfills task numbers and workspace keys in 0006 without losing linked rows', () => {
    const sqlite = new Database(':memory:')
    databases.push(sqlite)
    // Mirror production: Drizzle wraps migrations in one transaction, where PRAGMA foreign_keys
    // is a no-op, so enforcement must be off for the rebuild steps not to cascade.
    sqlite.pragma('foreign_keys = OFF')

    const apply = (file: string) => {
      const sql = readFileSync(new URL(`../drizzle/${file}`, import.meta.url), 'utf8')
      for (const statement of sql.split('--> statement-breakpoint')) {
        const trimmed = statement.trim()
        if (trimmed) sqlite.exec(trimmed)
      }
    }
    const before = readdirSync(new URL('../drizzle', import.meta.url))
      .filter(file => file.endsWith('.sql') && file < '0006')
      .sort()
    for (const file of before) apply(file)

    const at = (day: string) => `2026-01-0${day}T00:00:00.000Z`
    sqlite.exec(`
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at)
      VALUES ('user-a', 'a@example.test', 'A', 'h', '${at('1')}', '${at('1')}'),
             ('user-b', 'b@example.test', 'B', 'h', '${at('1')}', '${at('1')}');
      INSERT INTO workspaces (id, name, owner_id, created_at, updated_at)
      VALUES ('ws-1', 'Acme', 'user-a', '${at('1')}', '${at('1')}'),
             ('ws-2', 'Anvil', 'user-b', '${at('2')}', '${at('2')}'),
             ('ws-3', '9 Lives', 'user-b', '${at('3')}', '${at('3')}');
      INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
      VALUES ('ws-1', 'user-a', 'owner', '${at('1')}'), ('ws-2', 'user-b', 'owner', '${at('2')}');
      INSERT INTO tasks (id, user_id, workspace_id, title, created_at, updated_at)
      VALUES ('t-a2', 'user-a', 'ws-1', 'Second', '${at('2')}', '${at('2')}'),
             ('t-a1', 'user-a', 'ws-1', 'First', '${at('1')}', '${at('1')}'),
             ('t-a3', 'user-a', 'ws-1', 'Third', '${at('3')}', '${at('3')}'),
             ('t-b1', 'user-b', 'ws-2', 'Other', '${at('1')}', '${at('1')}');
      INSERT INTO task_day_selections (user_id, task_id, created_at)
      VALUES ('user-a', 't-a1', '${at('1')}');
    `)

    // Production applies migrations inside one transaction with enforcement disabled first; the
    // baseline files above were replayed outside one, so their PRAGMA statements took effect.
    sqlite.pragma('foreign_keys = OFF')
    sqlite.exec('BEGIN')
    apply('0006_past_rick_jones.sql')
    sqlite.exec('COMMIT')

    // Nothing may be cascade-deleted by the DROP TABLE steps in the rebuilds.
    const count = (table: string) =>
      (sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n
    expect(count('tasks')).toBe(4)
    expect(count('workspaces')).toBe(3)
    expect(count('workspace_members')).toBe(2)
    expect(count('task_day_selections')).toBe(1)
    expect(count('users')).toBe(2)

    // Numbers are consecutive per workspace, ordered by created_at, starting at 1.
    expect(sqlite.prepare('SELECT id, number FROM tasks WHERE workspace_id = ? ORDER BY number').all('ws-1'))
      .toEqual([{ id: 't-a1', number: 1 }, { id: 't-a2', number: 2 }, { id: 't-a3', number: 3 }])
    expect(sqlite.prepare('SELECT number FROM tasks WHERE id = ?').get('t-b1')).toEqual({ number: 1 })

    // Keys are unique, satisfy the CHECK charset, and collisions take an ordinal suffix.
    expect(sqlite.prepare('SELECT id, key FROM workspaces ORDER BY created_at').all())
      .toEqual([{ id: 'ws-1', key: 'A' }, { id: 'ws-2', key: 'A2' }, { id: 'ws-3', key: 'W' }])

    // Counters are seeded from the highest number so the next create cannot collide.
    expect(sqlite.prepare('SELECT id, task_counter FROM workspaces ORDER BY created_at').all())
      .toEqual([{ id: 'ws-1', task_counter: 3 }, { id: 'ws-2', task_counter: 1 }, { id: 'ws-3', task_counter: 0 }])

    expect(sqlite.prepare('SELECT DISTINCT estimate_scale FROM workspaces').all()).toEqual([{ estimate_scale: 'none' }])
    expect(sqlite.prepare('SELECT count(*) AS n FROM tasks WHERE estimate IS NOT NULL').get()).toEqual({ n: 0 })
    expect(sqlite.pragma('foreign_key_check')).toEqual([])
  })

  it('seeds workflows and maps legacy task statuses in 0007 and 0008 without losing linked rows', () => {
    const sqlite = new Database(':memory:')
    databases.push(sqlite)
    sqlite.pragma('foreign_keys = OFF')

    const apply = (file: string) => {
      const sql = readFileSync(new URL(`../drizzle/${file}`, import.meta.url), 'utf8')
      for (const statement of sql.split('--> statement-breakpoint')) {
        const trimmed = statement.trim()
        if (trimmed) sqlite.exec(trimmed)
      }
    }
    const before = readdirSync(new URL('../drizzle', import.meta.url))
      .filter(file => file.endsWith('.sql') && file < '0007')
      .sort()
    for (const file of before) apply(file)

    const at = (day: string) => `2026-01-0${day}T00:00:00.000Z`
    sqlite.exec(`
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at)
      VALUES ('user-a', 'a@example.test', 'A', 'h', '${at('1')}', '${at('1')}'),
             ('user-b', 'b@example.test', 'B', 'h', '${at('1')}', '${at('1')}');
      INSERT INTO workspaces (id, name, key, owner_id, task_counter, created_at, updated_at)
      VALUES ('ws-1', 'Acme', 'ACME', 'user-a', 3, '${at('1')}', '${at('1')}'),
             ('ws-2', 'Anvil', 'ANV', 'user-b', 1, '${at('2')}', '${at('2')}');
      INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
      VALUES ('ws-1', 'user-a', 'owner', '${at('1')}'), ('ws-2', 'user-b', 'owner', '${at('2')}');
      INSERT INTO tasks (id, user_id, workspace_id, title, status, number, completed_at, created_at, updated_at)
      VALUES ('t-todo', 'user-a', 'ws-1', 'Todo', 'todo', 1, NULL, '${at('1')}', '${at('4')}'),
             ('t-doing', 'user-a', 'ws-1', 'Doing', 'in_progress', 2, NULL, '${at('1')}', '${at('5')}'),
             ('t-done', 'user-a', 'ws-1', 'Done', 'done', 3, '${at('6')}', '${at('1')}', '${at('6')}'),
             ('t-other', 'user-b', 'ws-2', 'Other', 'todo', 1, NULL, '${at('1')}', '${at('1')}');
      INSERT INTO task_day_selections (user_id, task_id, created_at)
      VALUES ('user-a', 't-todo', '${at('1')}');
      INSERT INTO labels (id, workspace_id, name, created_at, updated_at)
      VALUES ('label-1', 'ws-1', 'bug', '${at('1')}', '${at('1')}');
      INSERT INTO task_labels (task_id, label_id, created_at)
      VALUES ('t-todo', 'label-1', '${at('1')}');
    `)

    // Production applies migrations inside one transaction with enforcement already off.
    sqlite.pragma('foreign_keys = OFF')
    sqlite.exec('BEGIN')
    apply('0007_statuses_add.sql')
    apply('0008_statuses_drop_legacy.sql')
    sqlite.exec('COMMIT')

    const count = (table: string) =>
      (sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n
    // Nothing may be cascade-deleted by the DROP TABLE in the tasks rebuild.
    expect(count('tasks')).toBe(4)
    expect(count('workspaces')).toBe(2)
    expect(count('workspace_members')).toBe(2)
    expect(count('task_day_selections')).toBe(1)
    expect(count('task_labels')).toBe(1)
    expect(count('users')).toBe(2)

    // Each workspace gets the documented five-status workflow with exactly one default.
    for (const workspaceId of ['ws-1', 'ws-2']) {
      expect(sqlite.prepare('SELECT name, category, position, is_default FROM statuses WHERE workspace_id = ? ORDER BY position').all(workspaceId))
        .toEqual([
          { name: 'Backlog', category: 'backlog', position: 0, is_default: 0 },
          { name: 'Todo', category: 'unstarted', position: 1, is_default: 1 },
          { name: 'In Progress', category: 'started', position: 2, is_default: 0 },
          { name: 'Done', category: 'completed', position: 3, is_default: 0 },
          { name: 'Canceled', category: 'canceled', position: 4, is_default: 0 },
        ])
    }

    // Seeded ids must be selectable through the API, whose id schema is a uuid.
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    const ids = sqlite.prepare('SELECT id FROM statuses').all() as Array<{ id: string }>
    expect(ids).toHaveLength(10)
    for (const { id } of ids) expect(id).toMatch(uuid)

    // Every task resolves to a status in its OWN workspace, with the category the legacy value maps to.
    expect(sqlite.prepare('SELECT count(*) AS n FROM tasks WHERE status_id IS NULL').get()).toEqual({ n: 0 })
    expect(sqlite.prepare(`
      SELECT t.id AS id, s.category AS category, (s.workspace_id = t.workspace_id) AS same_workspace
      FROM tasks t JOIN statuses s ON s.id = t.status_id ORDER BY t.id
    `).all()).toEqual([
      { id: 't-doing', category: 'started', same_workspace: 1 },
      { id: 't-done', category: 'completed', same_workspace: 1 },
      { id: 't-other', category: 'unstarted', same_workspace: 1 },
      { id: 't-todo', category: 'unstarted', same_workspace: 1 },
    ])

    // The legacy column and its check are gone.
    const columns = (sqlite.pragma('table_info(tasks)') as Array<{ name: string }>).map(column => column.name)
    expect(columns).not.toContain('status')
    expect(columns).toContain('status_id')
    expect(sqlite.prepare("SELECT count(*) AS n FROM sqlite_master WHERE sql LIKE '%tasks_status_check%'").get()).toEqual({ n: 0 })

    // started_at: the in-progress task keeps its own updated_at; completed and todo rows stay null.
    expect(sqlite.prepare('SELECT id, started_at FROM tasks ORDER BY id').all()).toEqual([
      { id: 't-doing', started_at: at('5') },
      { id: 't-done', started_at: null },
      { id: 't-other', started_at: null },
      { id: 't-todo', started_at: null },
    ])
    expect(sqlite.pragma('foreign_key_check')).toEqual([])
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
