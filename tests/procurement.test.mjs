import test from 'node:test';
import assert from 'node:assert/strict';
import built from '../dist/server/index.js';
import {database} from '../scripts/sqlite.mjs';
import {bootstrapControl,readControl} from '../src/control-store.js';
import {controlHash} from '../src/control.js';

test('procurement is discoverable across public clients without granting treasury access',async()=>{
  const db=database(),owner='email:procurement@example.test';
  const env={DB:db,NUMINA_CONTROL_OWNER:owner,NUMINA_CONTROL_API_KEY_SHA256:await controlHash('isolated-test-key'),NUMINA_LIVEMODE:'true',NUMINA_TELEMETRY_LOGS:'false'};
  try{
    await bootstrapControl(db,owner,Math.floor(Date.now()/1000));
    const before=await readControl(db);
    for(const route of ['/api/control/v1/manifest','/api/control/v2/architecture','/api/control/v2/manifest','/api/app/v1/catalog']){
      const response=await built.fetch(new Request('https://numina.test'+route),env);
      assert.equal(response.status,200,route);
      const body=await response.json();
      assert.equal(body.procurement_usage,true,route);
      assert.equal(body.procurement.automaticPurchasing,false,route);
      assert.equal(body.procurement.permissions,'existing_owner_and_delegated_permissions',route);
    }
    const discovery=await built.fetch(new Request('https://numina.test/api/control/v2/discovery-mcp',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({jsonrpc:'2.0',id:'procurement',method:'tools/call',params:{name:'numina_capabilities',arguments:{}}})
    }),env);
    assert.equal(discovery.status,200);
    const capabilities=JSON.parse((await discovery.json()).result.content[0].text);
    assert.equal(capabilities.procurement_usage,true);
    assert.equal(capabilities.externalExecution,false);
    const denied=await built.fetch(new Request('https://numina.test/api/control/v1/treasury',{
      method:'POST',headers:{'Content-Type':'application/json'},body:'{}'
    }),env);
    assert.ok([401,403].includes(denied.status));
    const after=await readControl(db);
    assert.equal(after.revision,before.revision);
    assert.equal(after.head_hash,before.head_hash);
  }finally{db.close();}
});
