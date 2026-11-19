-- Guest access. users.kind gains 'guest' (the column has no CHECK, so no rebuild is needed). Only a token's SHA-256 is stored.
CREATE TABLE `guest_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`group_id` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `guest_sessions_user_id_idx` ON `guest_sessions` (`user_id`);
--> statement-breakpoint
CREATE INDEX `guest_sessions_group_id_idx` ON `guest_sessions` (`group_id`);
--> statement-breakpoint
CREATE TABLE `guest_joins` (
	`group_id` text NOT NULL,
	`hour` text NOT NULL,
	`count` integer NOT NULL,
	PRIMARY KEY(`group_id`, `hour`),
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `guest_joins_hour_idx` ON `guest_joins` (`hour`);
