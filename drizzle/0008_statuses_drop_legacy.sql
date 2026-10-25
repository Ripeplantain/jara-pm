-- Hand-edited after `drizzle-kit generate`: Drizzle's `PRAGMA foreign_keys=OFF/ON` statements
-- were removed. Migrations run inside one transaction where that pragma is a no-op, so leaving
-- them in suggests a protection that is not there. `server/utils/database.ts` disables
-- enforcement around migrate() and restores it in a `finally`, which is what actually makes the
-- DROP TABLE below safe -- without it, dropping `tasks` would cascade away `task_labels` and
-- `task_day_selections`.
--
-- THIS MIGRATION IS IRREVERSIBLE. It drops `tasks.status` and `tasks_status_check`; there is no
-- down file. Once applied, the legacy 'todo'/'in_progress'/'done' values are gone, so if the
-- mapping applied in 0007 was wrong the information needed to redo it no longer exists.
-- Back up the database before the first boot on this image.
--
-- `status_id NOT NULL` in the rebuilt table is itself the assertion that 0007's backfill was
-- complete: any row it missed aborts the migration and rolls the whole transaction back.
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
	`status_id` text NOT NULL,
	`started_at` text,
	`priority` text DEFAULT 'none' NOT NULL,
	`due_date` text,
	`scheduled_for` text,
	`recurrence` text DEFAULT 'none' NOT NULL,
	`completed_at` text,
	`estimate` integer,
	`number` integer NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`milestone_id`) REFERENCES `milestones`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`status_id`) REFERENCES `statuses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "tasks_estimate_check" CHECK("__new_tasks"."estimate" is null or ("__new_tasks"."estimate" between 1 and 1000)),
	CONSTRAINT "tasks_priority_check" CHECK("__new_tasks"."priority" in ('none', 'low', 'medium', 'high')),
	CONSTRAINT "tasks_recurrence_check" CHECK("__new_tasks"."recurrence" in ('none', 'daily', 'weekly'))
);
--> statement-breakpoint
INSERT INTO `__new_tasks`("id", "user_id", "workspace_id", "assignee_id", "project_id", "milestone_id", "parent_id", "title", "description", "status_id", "started_at", "priority", "due_date", "scheduled_for", "recurrence", "completed_at", "estimate", "number", "position", "created_at", "updated_at") SELECT "id", "user_id", "workspace_id", "assignee_id", "project_id", "milestone_id", "parent_id", "title", "description", "status_id", "started_at", "priority", "due_date", "scheduled_for", "recurrence", "completed_at", "estimate", "number", "position", "created_at", "updated_at" FROM `tasks`;--> statement-breakpoint
DROP TABLE `tasks`;--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;--> statement-breakpoint
CREATE INDEX `idx_tasks_user_status_id` ON `tasks` (`user_id`,`status_id`);--> statement-breakpoint
CREATE INDEX `idx_tasks_user_due` ON `tasks` (`user_id`,`due_date`);--> statement-breakpoint
CREATE INDEX `idx_tasks_workspace_status_id` ON `tasks` (`workspace_id`,`status_id`);--> statement-breakpoint
CREATE INDEX `idx_tasks_workspace_due` ON `tasks` (`workspace_id`,`due_date`);--> statement-breakpoint
CREATE INDEX `idx_tasks_workspace_assignee` ON `tasks` (`workspace_id`,`assignee_id`);--> statement-breakpoint
CREATE INDEX `idx_tasks_project` ON `tasks` (`project_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_workspace_number_unique` ON `tasks` (`workspace_id`,`number`);