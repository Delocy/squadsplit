CREATE TABLE `receipt_scans` (
	`user_id` text NOT NULL,
	`day` text NOT NULL,
	`count` integer NOT NULL,
	PRIMARY KEY(`user_id`, `day`)
);
--> statement-breakpoint
CREATE INDEX `receipt_scans_day_idx` ON `receipt_scans` (`day`);