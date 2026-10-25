-- Hand-edited after `drizzle-kit generate` to add the seed and backfill below. The generator
-- produces the DDL but has no way to know what the rows should contain.
--
-- This migration is the ADDITIVE half of the status-category change: it creates `statuses`,
-- seeds each workspace's workflow, and fills `tasks.status_id` while the legacy `tasks.status`
-- column is still present. 0008 is the destructive half -- it drops `status` and enforces
-- `status_id NOT NULL` -- and depends on every row already having a value here.
CREATE TABLE `statuses` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "statuses_category_check" CHECK("statuses"."category" in ('backlog', 'unstarted', 'started', 'completed', 'canceled')),
	CONSTRAINT "statuses_is_default_check" CHECK("statuses"."is_default" in (0, 1))
);
--> statement-breakpoint
CREATE INDEX `idx_statuses_workspace_position` ON `statuses` (`workspace_id`,`position`);--> statement-breakpoint
CREATE INDEX `idx_statuses_workspace_category` ON `statuses` (`workspace_id`,`category`);--> statement-breakpoint
CREATE UNIQUE INDEX `statuses_workspace_default_unique` ON `statuses` (`workspace_id`) WHERE "statuses"."is_default" = 1;--> statement-breakpoint
CREATE UNIQUE INDEX `statuses_workspace_name_unique` ON `statuses` (`workspace_id`,`name`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `status_id` text REFERENCES statuses(id);--> statement-breakpoint
ALTER TABLE `tasks` ADD `started_at` text;
--> statement-breakpoint
-- Seed the fixed five-status workflow for every existing workspace.
--
-- The ids must be UUID-shaped: every API route validates ids with `idSchema` (a uuid), so a
-- status seeded as e.g. 'status-ws1-todo' could be stored but never selected through the API.
-- v4-shaped, built from randomblob with the version nibble forced to 4 and the variant to 8/9/a/b.
INSERT INTO `statuses` (`id`, `workspace_id`, `name`, `category`, `position`, `is_default`, `created_at`, `updated_at`)
SELECT
  lower(
    hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2)
    || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2)
    || '-' || hex(randomblob(6))
  ),
  w.`id`,
  seed.`name`,
  seed.`category`,
  seed.`position`,
  seed.`is_default`,
  w.`created_at`,
  w.`created_at`
FROM `workspaces` w
CROSS JOIN (
            SELECT 'Backlog'     AS name, 'backlog'   AS category, 0 AS position, 0 AS is_default
  UNION ALL SELECT 'Todo'        ,         'unstarted'           , 1           , 1
  UNION ALL SELECT 'In Progress' ,         'started'             , 2           , 0
  UNION ALL SELECT 'Done'        ,         'completed'           , 3           , 0
  UNION ALL SELECT 'Canceled'    ,         'canceled'            , 4           , 0
) seed;
--> statement-breakpoint
-- Backfill by CATEGORY rather than by name: the seed above guarantees exactly one status per
-- category per workspace, so this correlated subquery is single-valued. `todo` and any
-- unexpected legacy value both map to the unstarted status.
UPDATE `tasks`
SET `status_id` = (
  SELECT s.`id` FROM `statuses` s
  WHERE s.`workspace_id` = `tasks`.`workspace_id`
    AND s.`category` = CASE `tasks`.`status`
                         WHEN 'done'        THEN 'completed'
                         WHEN 'in_progress' THEN 'started'
                         ELSE 'unstarted'
                       END
);
--> statement-breakpoint
-- `started_at` records the first move into a `started` category, which history does not hold.
-- A task that is in progress right now is stamped with its own `updated_at`: a real timestamp
-- from the row, and the only evidence available, since it will never transition into `started`
-- again and would otherwise stay null forever. An already-completed task is left NULL rather
-- than guessing `completed_at`, which would report a cycle time of zero for all historical work.
UPDATE `tasks` SET `started_at` = `updated_at` WHERE `status` = 'in_progress';
