import { sql } from 'drizzle-orm'
import { check, foreignKey, index, integer, sqliteTable, text, unique, uniqueIndex } from 'drizzle-orm/sqlite-core'

const workspaceIdColumn = (): any => workspaces.id
const userIdColumn = (): any => users.id

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  activeWorkspaceId: text('active_workspace_id').references(workspaceIdColumn, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  ownerId: text('owner_id').notNull().references(userIdColumn, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const workspaceMembers = sqliteTable('workspace_members', {
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').notNull().$type<'owner' | 'member'>(),
  joinedAt: text('joined_at').notNull(),
}, table => [
  check('workspace_members_role_check', sql`${table.role} in ('owner', 'member')`),
  unique('workspace_members_workspace_user_unique').on(table.workspaceId, table.userId),
  index('idx_workspace_members_user').on(table.userId),
])

export const goals = sqliteTable('goals', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  status: text('status').notNull().$type<'active' | 'completed' | 'archived'>().default('active'),
  targetDate: text('target_date'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [
  check('goals_status_check', sql`${table.status} in ('active', 'completed', 'archived')`),
  index('idx_goals_user_status').on(table.userId, table.status),
  index('idx_goals_workspace_status').on(table.workspaceId, table.status),
])

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
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
  index('idx_projects_workspace_status').on(table.workspaceId, table.status),
])

export const milestones = sqliteTable('milestones', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
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
  index('idx_milestones_workspace_position').on(table.workspaceId, table.position),
])

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  assigneeId: text('assignee_id').references(() => users.id, { onDelete: 'set null' }),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
  milestoneId: text('milestone_id').references(() => milestones.id, { onDelete: 'set null' }),
  parentId: text('parent_id'),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  status: text('status').notNull().$type<'todo' | 'in_progress' | 'done'>().default('todo'),
  priority: text('priority').notNull().$type<'none' | 'low' | 'medium' | 'high'>().default('none'),
  dueDate: text('due_date'),
  scheduledFor: text('scheduled_for'),
  recurrence: text('recurrence').notNull().$type<'none' | 'daily' | 'weekly'>().default('none'),
  completedAt: text('completed_at'),
  position: integer('position').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [
  check('tasks_status_check', sql`${table.status} in ('todo', 'in_progress', 'done')`),
  check('tasks_priority_check', sql`${table.priority} in ('none', 'low', 'medium', 'high')`),
  check('tasks_recurrence_check', sql`${table.recurrence} in ('none', 'daily', 'weekly')`),
  index('idx_tasks_user_status').on(table.userId, table.status),
  index('idx_tasks_user_due').on(table.userId, table.dueDate),
  index('idx_tasks_workspace_status').on(table.workspaceId, table.status),
  index('idx_tasks_workspace_due').on(table.workspaceId, table.dueDate),
  index('idx_tasks_workspace_assignee').on(table.workspaceId, table.assigneeId),
  index('idx_tasks_project').on(table.projectId, table.position),
  foreignKey({
    columns: [table.parentId],
    foreignColumns: [table.id],
    name: 'tasks_parent_id_fkey',
  }).onDelete('set null'),
])

export const taskDaySelections = sqliteTable('task_day_selections', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull(),
}, table => [
  unique('task_day_selections_user_task_unique').on(table.userId, table.taskId),
  index('idx_task_day_selections_task').on(table.taskId),
])

export const workspaceInvites = sqliteTable('workspace_invites', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: text('role').notNull().$type<'member'>().default('member'),
  tokenHash: text('token_hash').notNull(),
  invitedBy: text('invited_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: text('expires_at').notNull(),
  acceptedAt: text('accepted_at'),
  acceptedBy: text('accepted_by').references(() => users.id, { onDelete: 'set null' }),
  revokedAt: text('revoked_at'),
  lastSentAt: text('last_sent_at'),
  createdAt: text('created_at').notNull(),
}, table => [
  check('workspace_invites_role_check', sql`${table.role} = 'member'`),
  index('idx_workspace_invites_workspace_status').on(table.workspaceId, table.acceptedAt, table.revokedAt),
  index('idx_workspace_invites_token_hash').on(table.tokenHash),
  uniqueIndex('workspace_invites_pending_email_unique')
    .on(table.workspaceId, table.email)
    .where(sql`${table.acceptedAt} is null and ${table.revokedAt} is null`),
])

export const aiProposals = sqliteTable('ai_proposals', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  payloadJson: text('payload_json').notNull(),
  status: text('status').notNull().$type<'pending' | 'accepted' | 'rejected'>().default('pending'),
  createdAt: text('created_at').notNull(),
  resolvedAt: text('resolved_at'),
}, table => [
  check('ai_proposals_status_check', sql`${table.status} in ('pending', 'accepted', 'rejected')`),
  index('idx_ai_proposals_workspace_status').on(table.workspaceId, table.status),
])

export const aiMessages = sqliteTable('ai_messages', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  role: text('role').notNull().$type<'user' | 'assistant'>(),
  content: text('content').notNull(),
  createdAt: text('created_at').notNull(),
}, table => [
  check('ai_messages_role_check', sql`${table.role} in ('user', 'assistant')`),
  index('idx_ai_messages_workspace_created').on(table.workspaceId, table.createdAt),
])

export const schema = {
  users,
  workspaces,
  workspaceMembers,
  goals,
  projects,
  milestones,
  tasks,
  taskDaySelections,
  workspaceInvites,
  aiProposals,
  aiMessages,
}
