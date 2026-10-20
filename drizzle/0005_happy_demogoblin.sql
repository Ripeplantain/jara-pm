CREATE TABLE `workspace_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`token_hash` text NOT NULL,
	`invited_by` text NOT NULL,
	`expires_at` text NOT NULL,
	`accepted_at` text,
	`accepted_by` text,
	`revoked_at` text,
	`last_sent_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`accepted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "workspace_invites_role_check" CHECK("workspace_invites"."role" = 'member')
);
--> statement-breakpoint
CREATE INDEX `idx_workspace_invites_workspace_status` ON `workspace_invites` (`workspace_id`,`accepted_at`,`revoked_at`);--> statement-breakpoint
CREATE INDEX `idx_workspace_invites_token_hash` ON `workspace_invites` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_invites_pending_email_unique` ON `workspace_invites` (`workspace_id`,`email`) WHERE "workspace_invites"."accepted_at" is null and "workspace_invites"."revoked_at" is null;