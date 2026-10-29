import { sqliteTable, integer, text, uniqueIndex, index, primaryKey } from 'drizzle-orm/sqlite-core';
// Existing legacy tables are retained unchanged. This migration owns only new tables.
export const controlState=sqliteTable('numina_control_state',{
 id:integer('id').primaryKey().notNull(),revision:integer('revision').notNull(),stateJson:text('state_json').notNull(),stateHash:text('state_hash').notNull(),headHash:text('head_hash').notNull(),mutationId:text('mutation_id').notNull()
});
export const controlEvents=sqliteTable('numina_control_events',{
 id:text('id').primaryKey().notNull(),revision:integer('revision').notNull(),actor:text('actor').notNull(),commandHash:text('command_hash').notNull(),eventJson:text('event_json').notNull(),hash:text('hash').notNull()
},table=>[uniqueIndex('numina_control_event_revision').on(table.revision)]);
export const serviceOrders=sqliteTable('numina_service_orders',{
 id:text('id').primaryKey().notNull(),ownerSubject:text('owner_subject').notNull(),ownerEmail:text('owner_email').notNull(),service:text('service').notNull(),title:text('title').notNull(),brief:text('brief').notNull(),successCriteria:text('success_criteria').notNull(),country:text('country').notNull(),status:text('status').notNull(),revision:integer('revision').notNull(),createdAt:integer('created_at').notNull(),updatedAt:integer('updated_at').notNull(),mutationId:text('mutation_id').notNull(),payloadHash:text('payload_hash').notNull(),consentVersion:text('consent_version').notNull(),lastMutation:text('last_mutation'),paymentRevision:integer('payment_revision').notNull().default(0)
},table=>[uniqueIndex('numina_service_order_request').on(table.ownerSubject,table.mutationId),index('numina_service_order_owner_id').on(table.ownerSubject,table.id)]);
export const serviceOrderEvents=sqliteTable('numina_service_order_events',{
 id:text('id').primaryKey().notNull(),orderId:text('order_id').notNull(),actor:text('actor').notNull(),action:text('action').notNull(),note:text('note').notNull(),revision:integer('revision').notNull(),createdAt:integer('created_at').notNull(),mutationId:text('mutation_id').notNull(),commandHash:text('command_hash').notNull()
},table=>[uniqueIndex('numina_service_order_event_revision').on(table.orderId,table.revision),uniqueIndex('numina_service_order_event_mutation').on(table.orderId,table.actor,table.mutationId)]);
export const appPayments=sqliteTable('numina_app_payments',{
 sessionId:text('session_id').primaryKey().notNull(),orderId:text('order_id').notNull(),paymentIntent:text('payment_intent'),amount:integer('amount').notNull(),status:text('status').notNull(),eventCreated:integer('event_created').notNull(),eventId:text('event_id').notNull()
},table=>[index('numina_app_payment_order').on(table.orderId),uniqueIndex('numina_app_payment_intent').on(table.paymentIntent)]);
export const appPaymentFacts=sqliteTable('numina_app_payment_facts',{
 eventId:text('event_id').primaryKey().notNull(),paymentIntent:text('payment_intent').notNull(),objectId:text('object_id').notNull(),kind:text('kind').notNull(),amount:integer('amount').notNull(),status:text('status').notNull(),eventCreated:integer('event_created').notNull()
},table=>[index('numina_app_fact_intent').on(table.paymentIntent)]);
export const appWebhookEvents=sqliteTable('numina_app_webhook_events',{
 id:text('id').primaryKey().notNull(),bodyHash:text('body_hash').notNull(),type:text('type').notNull(),receivedAt:integer('received_at').notNull()
});
export const appRate=sqliteTable('numina_app_rate',{
 bucket:text('bucket').notNull(),window:integer('window').notNull(),count:integer('count').notNull()
},table=>[primaryKey({columns:[table.bucket,table.window]}),index('numina_app_rate_window').on(table.window)]);

// Dedicated reviewer authentication limiter; all service records stay in production.
export const reviewLoginRate=sqliteTable('numina_review_login_rate',{bucket:text('bucket').notNull(),window:integer('window').notNull(),count:integer('count').notNull()},table=>[primaryKey({columns:[table.bucket,table.window]})]);
