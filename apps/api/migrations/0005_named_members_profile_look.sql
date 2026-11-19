ALTER TABLE `users` ADD `kind` text DEFAULT 'person' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `profile_animal` text;--> statement-breakpoint
ALTER TABLE `users` ADD `profile_color` text;