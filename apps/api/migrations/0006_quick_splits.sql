-- Hand-ordered: parents before children. is_payer defaults to 0 (SQLite booleans are integers).
CREATE TABLE `quick_splits` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`place` text,
	`spent_on` text NOT NULL,
	`currency` text DEFAULT 'SGD' NOT NULL,
	`service_charge_bps` integer,
	`gst_bps` integer,
	`share_token` text,
	`share_expires_at` text,
	`share_revoked_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "quick_splits_service_charge_bps_check" CHECK("quick_splits"."service_charge_bps" BETWEEN 0 AND 3000),
	CONSTRAINT "quick_splits_gst_bps_check" CHECK("quick_splits"."gst_bps" BETWEEN 0 AND 3000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quick_splits_share_token_unique` ON `quick_splits` (`share_token`);
--> statement-breakpoint
CREATE INDEX `quick_splits_owner_id_idx` ON `quick_splits` (`owner_id`);
--> statement-breakpoint
CREATE TABLE `quick_split_people` (
	`id` text PRIMARY KEY NOT NULL,
	`split_id` text NOT NULL,
	`name` text NOT NULL,
	`animal` text NOT NULL,
	`color` text NOT NULL,
	`position` integer NOT NULL,
	`is_payer` integer DEFAULT 0 NOT NULL,
	`paid_at` text,
	`paid_marked_by` text,
	FOREIGN KEY (`split_id`) REFERENCES `quick_splits`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "quick_split_people_paid_marked_by_check" CHECK("quick_split_people"."paid_marked_by" IN ('guest', 'payer'))
);
--> statement-breakpoint
CREATE INDEX `quick_split_people_split_id_idx` ON `quick_split_people` (`split_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `quick_split_people_payer_uq` ON `quick_split_people` (`split_id`) WHERE is_payer = 1;
--> statement-breakpoint
CREATE TABLE `quick_split_items` (
	`id` text PRIMARY KEY NOT NULL,
	`split_id` text NOT NULL,
	`name` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`split_id`) REFERENCES `quick_splits`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "quick_split_items_amount_cents_check" CHECK("quick_split_items"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE INDEX `quick_split_items_split_id_idx` ON `quick_split_items` (`split_id`);
--> statement-breakpoint
CREATE TABLE `quick_split_item_people` (
	`item_id` text NOT NULL,
	`person_id` text NOT NULL,
	PRIMARY KEY(`item_id`, `person_id`),
	FOREIGN KEY (`item_id`) REFERENCES `quick_split_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `quick_split_people`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `quick_split_ticks` (
	`split_id` text NOT NULL,
	`hour` text NOT NULL,
	`count` integer NOT NULL,
	PRIMARY KEY(`split_id`, `hour`),
	FOREIGN KEY (`split_id`) REFERENCES `quick_splits`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `quick_split_ticks_hour_idx` ON `quick_split_ticks` (`hour`);