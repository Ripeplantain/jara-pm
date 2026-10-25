-- Hand-edited after `drizzle-kit generate`.
-- The generated INSERT ... SELECT for both rebuilds referenced `key`, `number`, `estimate`,
-- `task_counter` and `estimate_scale` on the OLD tables, where those columns do not exist yet.
-- The columns are therefore added nullable and backfilled first, then the rebuilds carry the
-- real values across and enforce NOT NULL / UNIQUE / CHECK.
-- Drizzle's `PRAGMA foreign_keys=OFF/ON` statements were removed: migrations run inside one
-- transaction where that pragma is a no-op. `server/utils/database.ts` enables enforcement
-- after migrate() instead, which is what makes the DROP TABLE steps below safe.
ALTER TABLE `workspaces` ADD `key` text;
--> statement-breakpoint
ALTER TABLE `workspaces` ADD `task_counter` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `workspaces` ADD `estimate_scale` text DEFAULT 'none' NOT NULL;
--> statement-breakpoint
ALTER TABLE `tasks` ADD `estimate` integer;
--> statement-breakpoint
ALTER TABLE `tasks` ADD `number` integer;
--> statement-breakpoint
-- Workspace keys: the leading A-Z of the name, 'W' when it does not start with a letter.
-- Collisions take a stable ordinal suffix, ordered by created_at then id so replays match.
UPDATE `workspaces`
SET `key` = (
  SELECT CASE WHEN ranked.rn = 1 THEN ranked.base ELSE ranked.base || ranked.rn END
  FROM (
    SELECT w2.`id` AS id,
           CASE WHEN upper(substr(w2.`name`, 1, 1)) GLOB '[A-Z]'
                THEN upper(substr(w2.`name`, 1, 1)) ELSE 'W' END AS base,
           (SELECT count(*) FROM `workspaces` w3
             WHERE (CASE WHEN upper(substr(w3.`name`, 1, 1)) GLOB '[A-Z]'
                         THEN upper(substr(w3.`name`, 1, 1)) ELSE 'W' END)
                 = (CASE WHEN upper(substr(w2.`name`, 1, 1)) GLOB '[A-Z]'
                         THEN upper(substr(w2.`name`, 1, 1)) ELSE 'W' END)
               AND (w3.`created_at` < w2.`created_at`
                    OR (w3.`created_at` = w2.`created_at` AND w3.`id` <= w2.`id`))) AS rn
    FROM `workspaces` w2
  ) ranked
  WHERE ranked.id = `workspaces`.`id`
);
--> statement-breakpoint
-- Task numbers: consecutive from 1 per workspace, ordered by created_at then id.
-- A correlated count(*) here is quadratic -- measured 22.6 s for 20 000 tasks -- and this runs
-- inside the first database open, so Nitro would block on it. row_number() does the same dense
-- ranking in one pass: 25 ms for the same 20 000 rows, with identical numbers.
UPDATE `tasks`
SET `number` = ranked.rn
FROM (
  SELECT `id`,
         row_number() OVER (PARTITION BY `workspace_id` ORDER BY `created_at`, `id`) AS rn
  FROM `tasks`
) AS ranked
WHERE `tasks`.`id` = ranked.`id`;
--> statement-breakpoint
-- Seed each counter from the highest number assigned so the next create cannot collide.
UPDATE `workspaces`
SET `task_counter` = coalesce(
  (SELECT max(t.`number`) FROM `tasks` t WHERE t.`workspace_id` = `workspaces`.`id`), 0
);
--> statement-breakpoint
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
	FOREIGN KEY (`parent_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "tasks_status_check" CHECK("__new_tasks"."status" in ('todo', 'in_progress', 'done')),
	CONSTRAINT "tasks_estimate_check" CHECK("__new_tasks"."estimate" is null or ("__new_tasks"."estimate" between 1 and 1000)),
	CONSTRAINT "tasks_priority_check" CHECK("__new_tasks"."priority" in ('none', 'low', 'medium', 'high')),
	CONSTRAINT "tasks_recurrence_check" CHECK("__new_tasks"."recurrence" in ('none', 'daily', 'weekly'))
);
--> statement-breakpoint
INSERT INTO `__new_tasks`("id", "user_id", "workspace_id", "assignee_id", "project_id", "milestone_id", "parent_id", "title", "description", "status", "priority", "due_date", "scheduled_for", "recurrence", "completed_at", "estimate", "number", "position", "created_at", "updated_at") SELECT "id", "user_id", "workspace_id", "assignee_id", "project_id", "milestone_id", "parent_id", "title", "description", "status", "priority", "due_date", "scheduled_for", "recurrence", "completed_at", "estimate", "number", "position", "created_at", "updated_at" FROM `tasks`;
--> statement-breakpoint
DROP TABLE `tasks`;
--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;
--> statement-breakpoint
CREATE INDEX `idx_tasks_user_status` ON `tasks` (`user_id`,`status`);
--> statement-breakpoint
CREATE INDEX `idx_tasks_user_due` ON `tasks` (`user_id`,`due_date`);
--> statement-breakpoint
CREATE INDEX `idx_tasks_workspace_status` ON `tasks` (`workspace_id`,`status`);
--> statement-breakpoint
CREATE INDEX `idx_tasks_workspace_due` ON `tasks` (`workspace_id`,`due_date`);
--> statement-breakpoint
CREATE INDEX `idx_tasks_workspace_assignee` ON `tasks` (`workspace_id`,`assignee_id`);
--> statement-breakpoint
CREATE INDEX `idx_tasks_project` ON `tasks` (`project_id`,`position`);
--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_workspace_number_unique` ON `tasks` (`workspace_id`,`number`);
--> statement-breakpoint
CREATE TABLE `__new_workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`key` text NOT NULL,
	`task_counter` integer DEFAULT 0 NOT NULL,
	`estimate_scale` text DEFAULT 'none' NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "workspaces_key_check" CHECK(length("__new_workspaces"."key") between 1 and 5
      and "__new_workspaces"."key" glob '[A-Z]*'
      and "__new_workspaces"."key" not glob '*[^A-Z0-9]*'),
	CONSTRAINT "workspaces_estimate_scale_check" CHECK("__new_workspaces"."estimate_scale" in ('none', 'exponential', 'fibonacci', 'linear', 'tshirt')),
	CONSTRAINT "workspaces_task_counter_check" CHECK("__new_workspaces"."task_counter" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_workspaces`("id", "name", "key", "task_counter", "estimate_scale", "owner_id", "created_at", "updated_at") SELECT "id", "name", "key", "task_counter", "estimate_scale", "owner_id", "created_at", "updated_at" FROM `workspaces`;
--> statement-breakpoint
DROP TABLE `workspaces`;
--> statement-breakpoint
ALTER TABLE `__new_workspaces` RENAME TO `workspaces`;
--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_key_unique` ON `workspaces` (`key`);
--> statement-breakpoint
CREATE TABLE `label_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_label_groups_workspace_position` ON `label_groups` (`workspace_id`,`position`);
--> statement-breakpoint
CREATE UNIQUE INDEX `label_groups_workspace_name_unique` ON `label_groups` (`workspace_id`,`name`);
--> statement-breakpoint
CREATE TABLE `labels` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`group_id` text,
	`name` text NOT NULL,
	`color` text DEFAULT 'slate' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `label_groups`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "labels_color_check" CHECK("labels"."color" in ('slate', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'indigo', 'purple', 'pink'))
);
--> statement-breakpoint
CREATE INDEX `idx_labels_workspace_group` ON `labels` (`workspace_id`,`group_id`);
--> statement-breakpoint
CREATE INDEX `idx_labels_workspace_archived` ON `labels` (`workspace_id`,`archived_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `labels_workspace_name_unique` ON `labels` (`workspace_id`,`name`);
--> statement-breakpoint
CREATE TABLE `task_labels` (
	`task_id` text NOT NULL,
	`label_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`label_id`) REFERENCES `labels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_task_labels_label` ON `task_labels` (`label_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_labels_task_label_unique` ON `task_labels` (`task_id`,`label_id`);
