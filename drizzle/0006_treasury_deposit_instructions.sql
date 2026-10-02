CREATE TABLE `numina_deposit_intents` (`id` TEXT PRIMARY KEY NOT NULL, `owner` TEXT NOT NULL, `idempotency_key` TEXT NOT NULL, `intent_hash` TEXT NOT NULL, `intent_json` TEXT NOT NULL, `authorization_json` TEXT NOT NULL, `created_at` TEXT NOT NULL, `poll_generation` INTEGER NOT NULL DEFAULT 0, CONSTRAINT `numina_deposit_intents_owner_key` UNIQUE(`owner`,`idempotency_key`));
--> statement-breakpoint
CREATE TABLE `numina_deposit_observations` (`sequence` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `id` TEXT NOT NULL, `intent_id` TEXT NOT NULL, `generation` INTEGER NOT NULL, `observed_at` TEXT NOT NULL, `observation_json` TEXT NOT NULL, CONSTRAINT `numina_deposit_observations_id` UNIQUE(`id`));
--> statement-breakpoint
CREATE INDEX `numina_deposit_observation_intent` ON `numina_deposit_observations` (`intent_id`,`observed_at`,`sequence`);
--> statement-breakpoint
CREATE TABLE `numina_deposit_receipts` (`receipt_id` TEXT PRIMARY KEY NOT NULL, `intent_id` TEXT NOT NULL, `financial_account` TEXT NOT NULL, `created_at` TEXT NOT NULL, CONSTRAINT `numina_deposit_receipts_intent` UNIQUE(`intent_id`));
