import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {DatabaseSync} from 'node:sqlite';
const root=new URL('../drizzle/',import.meta.url),read=p=>fs.readFileSync(new URL(p,root),'utf8');
test('append-only deployment-intent migration applies to the existing schema without modifying existing tables',()=>{
 const db=new DatabaseSync(':memory:');try{
  const journal=JSON.parse(read('meta/_journal.json'));assert.ok(journal.entries.length>=6);const wallet=journal.entries.find(entry=>entry.tag==='0004_wallet_deployment_intents');assert.ok(wallet);
  for(const migration of journal.entries.filter(entry=>entry.idx<wallet.idx))db.exec(read(migration.tag+'.sql'));
  const before=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").all();
  db.exec(read('0004_wallet_deployment_intents.sql'));
  const after=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name!='numina_wallet_deployment_intents' ORDER BY name").all();assert.deepEqual(after,before);
  const columns=db.prepare('PRAGMA table_info(numina_wallet_deployment_intents)').all();assert.deepEqual(columns.map(c=>c.name),['deployment_key','owner','attempt_id','transaction_json','transaction_hash','created_at']);assert.equal(columns[0].pk,1);
 }finally{db.close();}
});
test('snapshot preserves every previous table and links the new migration',()=>{
 const previous=JSON.parse(read('meta/0003_snapshot.json')),next=JSON.parse(read('meta/0004_snapshot.json'));assert.equal(next.prevId,previous.id);assert.notEqual(next.id,previous.id);for(const [name,table]of Object.entries(previous.tables))assert.deepEqual(next.tables[name],table);assert.equal(Object.keys(next.tables).length,Object.keys(previous.tables).length+1);
});

test('manifest migration renames the durable control snapshot without changing rows',()=>{
 const db=new DatabaseSync(':memory:');try{
  for(const tag of ['0000_hard_midnight','0001_useful_black_crow','0002_chief_rachel_grey','0003_google_play_reviewer','0004_wallet_deployment_intents'])db.exec(read(tag+'.sql'));
  db.prepare('INSERT INTO numina_control_state(id,revision,state_json,state_hash,head_hash,mutation_id) VALUES(1,0,?,?,?,?)').run('{}','a'.repeat(64),'b'.repeat(64),'genesis');
  db.exec(read('0005_numina_manifest_control.sql'));
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='numina_control_state'").get().n,0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='numina_control_manifest'").get().n,1);
  assert.deepEqual(db.prepare('PRAGMA table_info(numina_control_manifest)').all().map(c=>c.name),['id','revision','manifest_json','manifest_hash','head_hash','mutation_id']);
  assert.equal(db.prepare('SELECT mutation_id FROM numina_control_manifest WHERE id=1').get().mutation_id,'genesis');
 }finally{db.close();}
});
test('manifest snapshot replaces only the durable control table identity',()=>{
 const previous=JSON.parse(read('meta/0004_snapshot.json')),next=JSON.parse(read('meta/0005_snapshot.json'));
 assert.equal(next.prevId,previous.id);assert.notEqual(next.id,previous.id);assert.equal(next.tables.numina_control_state,undefined);assert.ok(next.tables.numina_control_manifest);
 for(const [name,table] of Object.entries(previous.tables))if(name!=='numina_control_state')assert.deepEqual(next.tables[name],table);
});
