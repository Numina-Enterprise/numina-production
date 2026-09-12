CREATE TABLE `numina_control_events` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`actor` text NOT NULL,
	`command_hash` text NOT NULL,
	`event_json` text NOT NULL,
	`hash` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `numina_control_event_revision` ON `numina_control_events` (`revision`);--> statement-breakpoint
CREATE TABLE `numina_control_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`state_json` text NOT NULL,
	`state_hash` text NOT NULL,
	`head_hash` text NOT NULL,
	`mutation_id` text NOT NULL
);
