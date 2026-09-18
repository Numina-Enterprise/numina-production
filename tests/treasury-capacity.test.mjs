import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,unlinkSync,rmdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {database} from '../scripts/sqlite.mjs';
import {bootstrapControl,commitControl,readControl} from '../src/control-store.js';
import {controlHash,stable,reduceControl} from '../src/control.js';
import {createNuminaTreasury} from '../src/native-treasury.js';

test('treasury commits after 2048 journal events and survives restart in the same root',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'numina-capacity-')),file=join(dir,'manifest.sqlite');
  let db=database(file);
  const owner='email:capacity@example.test',now=Math.floor(Date.now()/1000);
  try{
    await bootstrapControl(db,owner,now);
    const initial=await readControl(db);
    let previous=initial.head_hash,manifest=initial.manifest,manifestHash=initial.manifest_hash,lastId;
    const statements=[];
    // Build a valid historical journal without quadratic fixture setup.
    for(let revision=1;revision<=2048;revision++){
      const command={id:'history-'+revision,expectedRevision:revision-1,type:'reconcile',data:{}};
      const reduced=await reduceControl(manifest,command,owner,revision-1,now);
      manifest=reduced.manifest;manifestHash=await controlHash(manifest);
      const commandHash=await controlHash(command);
      const event={id:command.id,revision,actor:owner,at:now,type:command.type,command,commandHash,previous,manifestHash,parents:reduced.parents,result:reduced.result,decisionsHash:await controlHash(reduced.decisions)};
      const hash=await controlHash(event);
      statements.push(db.prepare('INSERT INTO numina_control_events(id,revision,actor,command_hash,event_json,hash) VALUES(?,?,?,?,?,?)').bind(event.id,revision,owner,commandHash,stable(event),hash));
      previous=hash;lastId=event.id;
    }
    statements.push(db.prepare('UPDATE numina_control_manifest SET revision=?,manifest_json=?,manifest_hash=?,head_hash=?,mutation_id=? WHERE id=1').bind(2048,stable(manifest),manifestHash,previous,lastId));
    await db.batch(statements);
    const treasury=createNuminaTreasury({db,principal:owner,root:owner});
    const event={id:'treasury-beyond-old-cap',expectedRevision:2048,expectedHead:previous,Principal:owner,Authority:'NUMINA',Objective:'treasury.initialize',Intent:{operation:'INITIALIZE',reason:'Isolated capacity regression'}};
    const result=await treasury.writeTreasury(event);
    assert.equal(result.status,'FINAL');assert.equal(result.head_advancement.revision,2049);
    assert.equal(result.head_advancement.previous,previous);
    db.close();db=database(file);
    const reopened=createNuminaTreasury({db,principal:owner,root:owner});
    const record=await reopened.readTreasury();
    assert.equal(record.root,owner);assert.equal(record.revision,2049);
    assert.equal(record.head,result.canonical_proof.hash);
    assert.equal((await reopened.writeTreasury(event)).replayed,true);
    assert.equal((await readControl(db)).eventCount,2050);
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM numina_control_manifest').first()).count,1);
  }finally{db.close();unlinkSync(file);rmdirSync(dir);}
});

test('canonical treasury accepts a valid existing manifest beyond 512 KiB',async()=>{
  const db=database(),owner='email:large-manifest@example.test';
  try{
    await bootstrapControl(db,owner,Math.floor(Date.now()/1000));
    for(let i=0;i<48;i++)await commitControl(db,{
      id:'large-request-'+i,expectedRevision:i,type:'request',
      data:{id:'request-'+i,route:'internal.record.v1',wants:{resource:'record:capacity/'+i,payload:'字'.repeat(4000)},requiredEvidence:[]}
    },owner,Math.floor(Date.now()/1000));
    const before=await readControl(db);
    assert.ok(new TextEncoder().encode(stable(before.manifest)).byteLength>524288);
    const result=await createNuminaTreasury({db,principal:owner,root:owner}).writeTreasury({
      id:'large-manifest-treasury',expectedRevision:before.revision,expectedHead:before.head_hash,
      Principal:owner,Authority:'NUMINA',Objective:'treasury.initialize',Intent:{operation:'INITIALIZE',reason:'Isolated state-size regression'}
    });
    assert.equal(result.status,'FINAL');
    const after=await readControl(db);
    assert.equal(after.manifest.root,owner);assert.deepEqual(after.manifest.requests,before.manifest.requests);
    assert.equal(after.revision,49);assert.equal(after.eventCount,50);
  }finally{db.close();}
});
