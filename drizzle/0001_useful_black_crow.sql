CREATE TABLE `numina_app_payment_facts` (
	`event_id` text PRIMARY KEY NOT NULL,
	`payment_intent` text NOT NULL,
	`object_id` text NOT NULL,
	`kind` text NOT NULL,
	`amount` integer NOT NULL,
	`status` text NOT NULL,
	`event_created` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `numina_app_fact_intent` ON `numina_app_payment_facts` (`payment_intent`);--> statement-breakpoint
CREATE TABLE `numina_app_payments` (
	`session_id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`payment_intent` text,
	`amount` integer NOT NULL,
	`status` text NOT NULL,
	`event_created` integer NOT NULL,
	`event_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `numina_app_payment_order` ON `numina_app_payments` (`order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `numina_app_payment_intent` ON `numina_app_payments` (`payment_intent`);--> statement-breakpoint
CREATE TABLE `numina_app_rate` (
	`bucket` text NOT NULL,
	`window` integer NOT NULL,
	`count` integer NOT NULL,
	PRIMARY KEY(`bucket`, `window`)
);
--> statement-breakpoint
CREATE TABLE `numina_app_webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`body_hash` text NOT NULL,
	`type` text NOT NULL,
	`received_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `numina_service_order_events` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`note` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at` integer NOT NULL,
	`mutation_id` text NOT NULL,
	`command_hash` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `numina_service_order_event_revision` ON `numina_service_order_events` (`order_id`,`revision`);--> statement-breakpoint
CREATE UNIQUE INDEX `numina_service_order_event_mutation` ON `numina_service_order_events` (`order_id`,`actor`,`mutation_id`);--> statement-breakpoint
CREATE TABLE `numina_service_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_subject` text NOT NULL,
	`owner_email` text NOT NULL,
	`service` text NOT NULL,
	`title` text NOT NULL,
	`brief` text NOT NULL,
	`success_criteria` text NOT NULL,
	`country` text NOT NULL,
	`status` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`mutation_id` text NOT NULL,
	`payload_hash` text NOT NULL,
	`consent_version` text NOT NULL,
	`last_mutation` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `numina_service_order_request` ON `numina_service_orders` (`owner_subject`,`mutation_id`);--> statement-breakpoint
CREATE INDEX `numina_service_order_owner_id` ON `numina_service_orders` (`owner_subject`,`id`);