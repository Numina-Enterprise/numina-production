CREATE TABLE `numina_command_center_events` (
	`id` integer PRIMARY KEY NOT NULL,
	`event_key` text NOT NULL,
	`source` text NOT NULL,
	`type` text NOT NULL,
	`event_id` text NOT NULL,
	`body_hash` text NOT NULL,
	`summary` text NOT NULL,
	`payload` text NOT NULL,
	`received_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `numina_command_center_event_key` ON `numina_command_center_events` (`event_key`);--> statement-breakpoint
CREATE INDEX `numina_command_center_event_source` ON `numina_command_center_events` (`source`, `received_at`);--> statement-breakpoint
CREATE INDEX `numina_command_center_event_received` ON `numina_command_center_events` (`received_at`);
