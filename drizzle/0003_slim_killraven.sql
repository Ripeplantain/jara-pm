ALTER TABLE `ai_messages` ADD `workspace_id` text REFERENCES `workspaces`(`id`) ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE `ai_proposals` ADD `workspace_id` text REFERENCES `workspaces`(`id`) ON DELETE cascade;
--> statement-breakpoint
UPDATE `ai_messages`
SET `workspace_id` = (SELECT `active_workspace_id` FROM `users` WHERE `users`.`id` = `ai_messages`.`user_id`);
--> statement-breakpoint
UPDATE `ai_proposals`
SET `workspace_id` = (SELECT `active_workspace_id` FROM `users` WHERE `users`.`id` = `ai_proposals`.`user_id`);
--> statement-breakpoint
CREATE TABLE `__new_ai_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ai_messages_role_check" CHECK("__new_ai_messages"."role" in ('user', 'assistant'))
);
--> statement-breakpoint
INSERT INTO `__new_ai_messages` (`id`, `user_id`, `workspace_id`, `role`, `content`, `created_at`)
SELECT `id`, `user_id`, `workspace_id`, `role`, `content`, `created_at` FROM `ai_messages`;
--> statement-breakpoint
DROP TABLE `ai_messages`;
--> statement-breakpoint
ALTER TABLE `__new_ai_messages` RENAME TO `ai_messages`;
--> statement-breakpoint
CREATE INDEX `idx_ai_messages_workspace_created` ON `ai_messages` (`workspace_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `__new_ai_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ai_proposals_status_check" CHECK("__new_ai_proposals"."status" in ('pending', 'accepted', 'rejected'))
);
--> statement-breakpoint
INSERT INTO `__new_ai_proposals` (`id`, `user_id`, `workspace_id`, `kind`, `payload_json`, `status`, `created_at`, `resolved_at`)
SELECT `id`, `user_id`, `workspace_id`, `kind`, `payload_json`, `status`, `created_at`, `resolved_at` FROM `ai_proposals`;
--> statement-breakpoint
DROP TABLE `ai_proposals`;
--> statement-breakpoint
ALTER TABLE `__new_ai_proposals` RENAME TO `ai_proposals`;
--> statement-breakpoint
CREATE INDEX `idx_ai_proposals_workspace_status` ON `ai_proposals` (`workspace_id`,`status`);
