import { sqliteTable, integer, text, uniqueIndex, unique, index, primaryKey } from 'drizzle-orm/sqlite-core';
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

// Owner intent and provider observations remain outside the native NUSD journal.
export const depositIntents=sqliteTable('numina_deposit_intents',{
 id:text('id').primaryKey().notNull(),owner:text('owner').notNull(),idempotencyKey:text('idempotency_key').notNull(),intentHash:text('intent_hash').notNull(),intentJson:text('intent_json').notNull(),authorizationJson:text('authorization_json').notNull(),createdAt:text('created_at').notNull(),pollGeneration:integer('poll_generation').notNull().default(0)
},table=>[unique('numina_deposit_intents_owner_key').on(table.owner,table.idempotencyKey)]);
export const depositObservations=sqliteTable('numina_deposit_observations',{
 sequence:integer('sequence').primaryKey({autoIncrement:true}).notNull(),id:text('id').notNull(),intentId:text('intent_id').notNull(),generation:integer('generation').notNull(),observedAt:text('observed_at').notNull(),observationJson:text('observation_json').notNull()
},table=>[unique('numina_deposit_observations_id').on(table.id),index('numina_deposit_observation_intent').on(table.intentId,table.observedAt,table.sequence)]);
export const depositReceipts=sqliteTable('numina_deposit_receipts',{
 receiptId:text('receipt_id').primaryKey().notNull(),intentId:text('intent_id').notNull(),financialAccount:text('financial_account').notNull(),createdAt:text('created_at').notNull()
},table=>[unique('numina_deposit_receipts_intent').on(table.intentId)]);
