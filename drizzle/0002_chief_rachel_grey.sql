ALTER TABLE `numina_service_orders` ADD `payment_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `numina_app_rate_window` ON `numina_app_rate` (`window`);