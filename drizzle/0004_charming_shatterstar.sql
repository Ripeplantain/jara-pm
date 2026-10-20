CREATE TABLE `__task_day_selections` (
	`user_id` text NOT NULL,
	`task_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__task_day_selections`("user_id", "task_id", "created_at")
SELECT "user_id", "id", "updated_at"
FROM `tasks`
WHERE "selected_for_today" = 1;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`assignee_id` text,
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
	`completed_at` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`milestone_id`) REFERENCES `milestones`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`parent_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "tasks_status_check" CHECK("__new_tasks"."status" in ('todo', 'in_progress', 'done')),
	CONSTRAINT "tasks_priority_check" CHECK("__new_tasks"."priority" in ('none', 'low', 'medium', 'high')),
	CONSTRAINT "tasks_recurrence_check" CHECK("__new_tasks"."recurrence" in ('none', 'daily', 'weekly'))
);
--> statement-breakpoint
INSERT INTO `__new_tasks`("id", "user_id", "workspace_id", "assignee_id", "project_id", "milestone_id", "parent_id", "title", "description", "status", "priority", "due_date", "scheduled_for", "recurrence", "completed_at", "position", "created_at", "updated_at") SELECT "id", "user_id", "workspace_id", NULL, "project_id", "milestone_id", "parent_id", "title", "description", "status", "priority", "due_date", "scheduled_for", "recurrence", "completed_at", "position", "created_at", "updated_at" FROM `tasks`;--> statement-breakpoint
DROP TABLE `tasks`;--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_tasks_user_status` ON `tasks` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_tasks_user_due` ON `tasks` (`user_id`,`due_date`);--> statement-breakpoint
CREATE INDEX `idx_tasks_workspace_status` ON `tasks` (`workspace_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_tasks_workspace_due` ON `tasks` (`workspace_id`,`due_date`);--> statement-breakpoint
CREATE INDEX `idx_tasks_workspace_assignee` ON `tasks` (`workspace_id`,`assignee_id`);--> statement-breakpoint
CREATE INDEX `idx_tasks_project` ON `tasks` (`project_id`,`position`);--> statement-breakpoint
CREATE TABLE `task_day_selections` (
	`user_id` text NOT NULL,
	`task_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `task_day_selections`("user_id", "task_id", "created_at")
SELECT "user_id", "task_id", "created_at" FROM `__task_day_selections`;--> statement-breakpoint
DROP TABLE `__task_day_selections`;--> statement-breakpoint
CREATE INDEX `idx_task_day_selections_task` ON `task_day_selections` (`task_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `task_day_selections_user_task_unique` ON `task_day_selections` (`user_id`,`task_id`);
