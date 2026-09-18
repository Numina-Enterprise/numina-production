import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const {FRONTIER_SCHEMA,createNumina,projectLegacyRuntime}=require('../runtime/vercel-production/lib/frontier.js');

test('NUMINA transitions only to NUMINA',async()=>{
  const initial=createNumina({
    manifest:{root:'NUMINA',manifest:'NUMINA',total:'1000T',branches:{USD:'500T',USDC:'500T'}},
    execute:async(manifest,intent)=>({...manifest,lastIntent:intent.id})
  });
  const next=await initial.execute({id:'intent-1'});
  assert.equal(next.schema,FRONTIER_SCHEMA);
  assert.deepEqual(next.manifest,{total:'1000T',branches:{USD:'500T',USDC:'500T'},lastIntent:'intent-1'});
  assert.equal(initial.manifest.lastIntent,undefined);
});

test('legacy runtime is a projection of NUMINA, not another authority',()=>{
  const numina=createNumina({manifest:{root:'NUMINA',manifest:'NUMINA',total:'1000T'},execute:async manifest=>manifest});
  const projected=projectLegacyRuntime(numina);
  assert.equal(projected.NUMINA,numina);
  assert.deepEqual(projected.compatibility,{authority:'NUMINA',canonical:true});
});
