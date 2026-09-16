import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {DatabaseSync} from 'node:sqlite';
const root=new URL('../drizzle/',import.meta.url),read=p=>fs.readFileSync(new URL(p,root),'utf8');
test('append-only deployment-intent migration applies to the existing schema without modifying existing tables',()=>{
 const db=new DatabaseSync(':memory:');try{
  const journal=JSON.parse(read('meta/_journal.json'));assert.equal(journal.entries.length,5);assert.equal(journal.entries.at(-1).tag,'0004_wallet_deployment_intents');
  for(const migration of journal.entries.slice(0,-1))db.exec(read(migration.tag+'.sql'));
  const before=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").all();
  db.exec(read('0004_wallet_deployment_intents.sql'));
  const after=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name!='numina_wallet_deployment_intents' ORDER BY name").all();assert.deepEqual(after,before);
  const columns=db.prepare('PRAGMA table_info(numina_wallet_deployment_intents)').all();assert.deepEqual(columns.map(c=>c.name),['deployment_key','owner','attempt_id','transaction_json','transaction_hash','created_at']);assert.equal(columns[0].pk,1);
 }finally{db.close();}
});
test('snapshot preserves every previous table and links the new migration',()=>{
 const previous=JSON.parse(read('meta/0003_snapshot.json')),next=JSON.parse(read('meta/0004_snapshot.json'));assert.equal(next.prevId,previous.id);assert.notEqual(next.id,previous.id);for(const [name,table]of Object.entries(previous.tables))assert.deepEqual(next.tables[name],table);assert.equal(Object.keys(next.tables).length,Object.keys(previous.tables).length+1);
});
