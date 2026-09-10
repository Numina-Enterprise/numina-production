import { sqliteTable, integer, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
// Existing legacy tables are retained unchanged. This migration owns only new tables.
export const controlState=sqliteTable('numina_control_state',{
 id:integer('id').primaryKey().notNull(),revision:integer('revision').notNull(),stateJson:text('state_json').notNull(),stateHash:text('state_hash').notNull(),headHash:text('head_hash').notNull(),mutationId:text('mutation_id').notNull()
});
export const controlEvents=sqliteTable('numina_control_events',{
 id:text('id').primaryKey().notNull(),revision:integer('revision').notNull(),actor:text('actor').notNull(),commandHash:text('command_hash').notNull(),eventJson:text('event_json').notNull(),hash:text('hash').notNull()
},table=>[uniqueIndex('numina_control_event_revision').on(table.revision)]);
