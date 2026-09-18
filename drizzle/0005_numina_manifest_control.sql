ALTER TABLE `numina_control_state` RENAME TO `numina_control_manifest`;
--> statement-breakpoint
ALTER TABLE `numina_control_manifest` RENAME COLUMN `state_json` TO `manifest_json`;
--> statement-breakpoint
ALTER TABLE `numina_control_manifest` RENAME COLUMN `state_hash` TO `manifest_hash`;
