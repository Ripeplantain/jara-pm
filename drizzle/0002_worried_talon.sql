CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `workspace_members` (
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`joined_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "workspace_members_role_check" CHECK("workspace_members"."role" in ('owner', 'member'))
);
--> statement-breakpoint
CREATE INDEX `idx_workspace_members_user` ON `workspace_members` (`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_members_workspace_user_unique` ON `workspace_members` (`workspace_id`,`user_id`);
--> statement-breakpoint
ALTER TABLE `users` ADD `active_workspace_id` text REFERENCES `workspaces`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `goals` ADD `workspace_id` text REFERENCES `workspaces`(`id`) ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE `projects` ADD `workspace_id` text REFERENCES `workspaces`(`id`) ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE `milestones` ADD `workspace_id` text REFERENCES `workspaces`(`id`) ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE `tasks` ADD `workspace_id` text REFERENCES `workspaces`(`id`) ON DELETE cascade;
--> statement-breakpoint
INSERT INTO `workspaces` (`id`, `name`, `owner_id`, `created_at`, `updated_at`)
SELECT lower(hex(randomblob(16))), `name` || char(39) || 's workspace', `id`, `created_at`, `updated_at`
FROM `users`;
--> statement-breakpoint
INSERT INTO `workspace_members` (`workspace_id`, `user_id`, `role`, `joined_at`)
SELECT `id`, `owner_id`, 'owner', `created_at`
FROM `workspaces`;
--> statement-breakpoint
UPDATE `users`
SET `active_workspace_id` = (SELECT `id` FROM `workspaces` WHERE `owner_id` = `users`.`id`);
--> statement-breakpoint
UPDATE `goals`
SET `workspace_id` = (SELECT `active_workspace_id` FROM `users` WHERE `users`.`id` = `goals`.`user_id`);
--> statement-breakpoint
UPDATE `projects`
SET `workspace_id` = (SELECT `active_workspace_id` FROM `users` WHERE `users`.`id` = `projects`.`user_id`);
--> statement-breakpoint
UPDATE `milestones`
SET `workspace_id` = (SELECT `active_workspace_id` FROM `users` WHERE `users`.`id` = `milestones`.`user_id`);
--> statement-breakpoint
UPDATE `tasks`
SET `workspace_id` = (SELECT `active_workspace_id` FROM `users` WHERE `users`.`id` = `tasks`.`user_id`);
--> statement-breakpoint
CREATE TABLE `__new_goals` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`target_date` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "goals_status_check" CHECK("__new_goals"."status" in ('active', 'completed', 'archived'))
);
--> statement-breakpoint
INSERT INTO `__new_goals` (`id`, `user_id`, `workspace_id`, `title`, `description`, `status`, `target_date`, `created_at`, `updated_at`)
SELECT `id`, `user_id`, `workspace_id`, `title`, `description`, `status`, `target_date`, `created_at`, `updated_at` FROM `goals`;
--> statement-breakpoint
CREATE TABLE `__new_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`goal_id` text,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`target_date` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`goal_id`) REFERENCES `__new_goals`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "projects_status_check" CHECK("__new_projects"."status" in ('active', 'paused', 'completed', 'archived'))
 );
--> statement-breakpoint
INSERT INTO `__new_projects` (`id`, `user_id`, `workspace_id`, `goal_id`, `title`, `description`, `status`, `target_date`, `created_at`, `updated_at`)
SELECT `id`, `user_id`, `workspace_id`, `goal_id`, `title`, `description`, `status`, `target_date`, `created_at`, `updated_at` FROM `projects`;
--> statement-breakpoint
CREATE TABLE `__new_milestones` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`target_date` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `__new_projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "milestones_status_check" CHECK("__new_milestones"."status" in ('active', 'completed'))
 );
--> statement-breakpoint
INSERT INTO `__new_milestones` (`id`, `user_id`, `workspace_id`, `project_id`, `title`, `description`, `status`, `target_date`, `position`, `created_at`, `updated_at`)
SELECT `id`, `user_id`, `workspace_id`, `project_id`, `title`, `description`, `status`, `target_date`, `position`, `created_at`, `updated_at` FROM `milestones`;
--> statement-breakpoint
CREATE TABLE `__new_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text,
	`milestone_id` text,
	`parent_id` text,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'todo' NOT NULL,
	`priority` text DEFAULT 'none' NOT NULL,
	`due_date` text,
	`scheduled_for` text,
	`recurrence` text DEFAULT 'none' NOT NULL,
	`selected_for_today` integer DEFAULT false NOT NULL,
	`completed_at` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `__new_projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`milestone_id`) REFERENCES `__new_milestones`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`parent_id`) REFERENCES `__new_tasks`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "tasks_status_check" CHECK("__new_tasks"."status" in ('todo', 'in_progress', 'done')),
	CONSTRAINT "tasks_priority_check" CHECK("__new_tasks"."priority" in ('none', 'low', 'medium', 'high')),
	CONSTRAINT "tasks_recurrence_check" CHECK("__new_tasks"."recurrence" in ('none', 'daily', 'weekly')),
	CONSTRAINT "tasks_selected_for_today_check" CHECK("__new_tasks"."selected_for_today" in (0, 1))
 );
--> statement-breakpoint
INSERT INTO `__new_tasks` (`id`, `user_id`, `workspace_id`, `project_id`, `milestone_id`, `parent_id`, `title`, `description`, `status`, `priority`, `due_date`, `scheduled_for`, `recurrence`, `selected_for_today`, `completed_at`, `position`, `created_at`, `updated_at`)
SELECT `id`, `user_id`, `workspace_id`, `project_id`, `milestone_id`, `parent_id`, `title`, `description`, `status`, `priority`, `due_date`, `scheduled_for`, `recurrence`, `selected_for_today`, `completed_at`, `position`, `created_at`, `updated_at` FROM `tasks`;
--> statement-breakpoint
DROP TABLE `tasks`;
--> statement-breakpoint
DROP TABLE `milestones`;
--> statement-breakpoint
DROP TABLE `projects`;
--> statement-breakpoint
DROP TABLE `goals`;
--> statement-breakpoint
ALTER TABLE `__new_goals` RENAME TO `goals`;
--> statement-breakpoint
ALTER TABLE `__new_projects` RENAME TO `projects`;
--> statement-breakpoint
ALTER TABLE `__new_milestones` RENAME TO `milestones`;
--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;
--> statement-breakpoint
CREATE INDEX `idx_goals_user_status` ON `goals` (`user_id`,`status`);
--> statement-breakpoint
CREATE INDEX `idx_goals_workspace_status` ON `goals` (`workspace_id`,`status`);
--> statement-breakpoint
CREATE INDEX `idx_projects_user_status` ON `projects` (`user_id`,`status`);
--> statement-breakpoint
CREATE INDEX `idx_projects_workspace_status` ON `projects` (`workspace_id`,`status`);
--> statement-breakpoint
CREATE INDEX `idx_milestones_project_position` ON `milestones` (`project_id`,`position`);
--> statement-breakpoint
CREATE INDEX `idx_milestones_workspace_position` ON `milestones` (`workspace_id`,`position`);
--> statement-breakpoint
CREATE INDEX `idx_tasks_user_status` ON `tasks` (`user_id`,`status`);
--> statement-breakpoint
CREATE INDEX `idx_tasks_user_due` ON `tasks` (`user_id`,`due_date`);
--> statement-breakpoint
CREATE INDEX `idx_tasks_workspace_status` ON `tasks` (`workspace_id`,`status`);
--> statement-breakpoint
CREATE INDEX `idx_tasks_workspace_due` ON `tasks` (`workspace_id`,`due_date`);
--> statement-breakpoint
CREATE INDEX `idx_tasks_project` ON `tasks` (`project_id`,`position`);
