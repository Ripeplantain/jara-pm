import { sql } from 'drizzle-orm'
import { check, foreignKey, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const goals = sqliteTable('goals', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  status: text('status').notNull().$type<'active' | 'completed' | 'archived'>().default('active'),
  targetDate: text('target_date'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [
  check('goals_status_check', sql`${table.status} in ('active', 'completed', 'archived')`),
  index('idx_goals_user_status').on(table.userId, table.status),
])

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  goalId: text('goal_id').references(() => goals.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  status: text('status').notNull().$type<'active' | 'paused' | 'completed' | 'archived'>().default('active'),
  targetDate: text('target_date'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [
  check('projects_status_check', sql`${table.status} in ('active', 'paused', 'completed', 'archived')`),
  index('idx_projects_user_status').on(table.userId, table.status),
])

export const milestones = sqliteTable('milestones', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  status: text('status').notNull().$type<'active' | 'completed'>().default('active'),
  targetDate: text('target_date'),
  position: integer('position').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [
  check('milestones_status_check', sql`${table.status} in ('active', 'completed')`),
  index('idx_milestones_project_position').on(table.projectId, table.position),
])

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
  milestoneId: text('milestone_id').references(() => milestones.id, { onDelete: 'set null' }),
  parentId: text('parent_id'),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  status: text('status').notNull().$type<'todo' | 'in_progress' | 'done'>().default('todo'),
  priority: text('priority').notNull().$type<'none' | 'low' | 'medium' | 'high'>().default('none'),
  dueDate: text('due_date'),
  scheduledFor: text('scheduled_for'),
  selectedForToday: integer('selected_for_today', { mode: 'boolean' }).notNull().default(false),
  completedAt: text('completed_at'),
  position: integer('position').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [
  check('tasks_status_check', sql`${table.status} in ('todo', 'in_progress', 'done')`),
  check('tasks_priority_check', sql`${table.priority} in ('none', 'low', 'medium', 'high')`),
  check('tasks_selected_for_today_check', sql`${table.selectedForToday} in (0, 1)`),
  index('idx_tasks_user_status').on(table.userId, table.status),
  index('idx_tasks_user_due').on(table.userId, table.dueDate),
  index('idx_tasks_project').on(table.projectId, table.position),
  foreignKey({
    columns: [table.parentId],
    foreignColumns: [table.id],
    name: 'tasks_parent_id_fkey',
  }).onDelete('set null'),
])

export const aiProposals = sqliteTable('ai_proposals', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  payloadJson: text('payload_json').notNull(),
  status: text('status').notNull().$type<'pending' | 'accepted' | 'rejected'>().default('pending'),
  createdAt: text('created_at').notNull(),
  resolvedAt: text('resolved_at'),
}, table => [
  check('ai_proposals_status_check', sql`${table.status} in ('pending', 'accepted', 'rejected')`),
])

export const aiMessages = sqliteTable('ai_messages', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').notNull().$type<'user' | 'assistant'>(),
  content: text('content').notNull(),
  createdAt: text('created_at').notNull(),
}, table => [
  check('ai_messages_role_check', sql`${table.role} in ('user', 'assistant')`),
])

export const schema = {
  users,
  goals,
  projects,
  milestones,
  tasks,
  aiProposals,
  aiMessages,
}
