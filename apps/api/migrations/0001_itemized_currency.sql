CREATE TABLE `expense_item_users` (
	`item_id` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`item_id`, `user_id`),
	FOREIGN KEY (`item_id`) REFERENCES `expense_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `expense_items` (
	`id` text PRIMARY KEY NOT NULL,
	`expense_id` text NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`amount_cents` integer NOT NULL,
	FOREIGN KEY (`expense_id`) REFERENCES `expenses`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "expense_items_amount_cents_check" CHECK("expense_items"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE INDEX `expense_items_expense_id_idx` ON `expense_items` (`expense_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`description` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`paid_by` text NOT NULL,
	`created_by` text NOT NULL,
	`category` text NOT NULL,
	`spent_on` text NOT NULL,
	`split_type` text NOT NULL,
	`currency` text NOT NULL,
	`fx_rate_ppm` integer DEFAULT 1000000 NOT NULL,
	`service_charge_bps` integer,
	`gst_bps` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`paid_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "expenses_amount_cents_check" CHECK("__new_expenses"."amount_cents" > 0),
	CONSTRAINT "expenses_split_type_check" CHECK("__new_expenses"."split_type" IN ('equal', 'exact', 'itemized'))
);
--> statement-breakpoint
-- New columns: currency comes from the expense's group, the fx rate is 1:1, and old expenses have no service charge or GST.
INSERT INTO `__new_expenses`("id", "group_id", "description", "amount_cents", "paid_by", "created_by", "category", "spent_on", "split_type", "currency", "fx_rate_ppm", "service_charge_bps", "gst_bps", "created_at", "updated_at") SELECT "id", "group_id", "description", "amount_cents", "paid_by", "created_by", "category", "spent_on", "split_type", (SELECT `groups`.`currency` FROM `groups` WHERE `groups`.`id` = `expenses`.`group_id`), 1000000, NULL, NULL, "created_at", "updated_at" FROM `expenses`;--> statement-breakpoint
-- D1 keeps foreign keys on inside a migration, so dropping `expenses` would cascade-delete every
-- expense_shares row. Park the shares in a backup table across the rebuild and put them back.
CREATE TABLE `__expense_shares_backup` AS SELECT `expense_id`, `user_id`, `amount_cents` FROM `expense_shares`;--> statement-breakpoint
DELETE FROM `expense_shares`;--> statement-breakpoint
DROP TABLE `expenses`;--> statement-breakpoint
ALTER TABLE `__new_expenses` RENAME TO `expenses`;--> statement-breakpoint
INSERT INTO `expense_shares`(`expense_id`, `user_id`, `amount_cents`) SELECT `expense_id`, `user_id`, `amount_cents` FROM `__expense_shares_backup`;--> statement-breakpoint
DROP TABLE `__expense_shares_backup`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `expenses_group_id_idx` ON `expenses` (`group_id`);