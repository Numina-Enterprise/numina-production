import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const {createRuntimeNumina,compatibilityProjection}=require('../runtime/vercel-production/lib/numina-runtime.js');

test('runtime capabilities execute as NUMINA intents',async()=>{
  const numina=createRuntimeNumina();
  const next=await numina.execute({kind:'observe',body:{provider:'custom',value:'observation'}});
  assert.equal(next.manifest.authority,'NUMINA');
  assert.deepEqual(next.manifest.last,{kind:'observe',observed:{provider:'custom',value:'observation'}});
});

test('legacy compatibility remains a NUMINA projection',()=>{
  const projected=compatibilityProjection();
  assert.equal(projected.compatibility.authority,'NUMINA');
  assert.equal(projected.compatibility.canonical,true);
  assert.equal(projected.NUMINA.manifest.authority,'NUMINA');
});
