import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {database} from '../scripts/sqlite.mjs';
import {bootstrapControl,readControl,commitControl} from '../src/control-store.js';
import {controlHash} from '../src/control.js';
import worker from '../src/worker.js';
const owner='email:owner@example.test',delegate='email:delegate@example.test',key='local-owner-test-key';
const path='/api/control/v1/treasury-attestation';
const identity=email=>({'oai-authenticated-user-id':'platform-test-user','oai-authenticated-user-email':email});
const request=(headers={},method='GET')=>new Request('https://numina.test'+path,{headers,method});
const containsPrivate=s=>/500000000000000|500,000,000,000,000|Bank of America|Treasury transfers and NUSD settlement are active\. Funds moved\./.test(s);
async function fixture(){const DB=database(),now=Math.floor(Date.now()/1000);await bootstrapControl(DB,owner,now);return {DB,NUMINA_CONTROL_OWNER:owner,NUMINA_CONTROL_API_KEY_SHA256:await controlHash(key)};}

test('treasury statement is owner-only, private, exact decimal data and cannot activate or allocate funds',async()=>{
 const env=await fixture();try{
  const before=await readControl(env.DB);
  for(const headers of [{},{Authorization:'Bearer invalid'},identity('other@example.test')]){
   const res=await worker.fetch(request(headers),env);assert.equal(res.status,headers['oai-authenticated-user-email']?403:401);assert.equal(containsPrivate(await res.text()),false);
  }
  for(const headers of [{Authorization:'Bearer '+key},identity('owner@example.test')]){
   const res=await worker.fetch(request(headers),env);assert.equal(res.status,200);assert.equal(res.headers.get('Cache-Control'),'private, no-store');assert.equal(res.headers.get('Vary'),'Cookie, Authorization');
   const statement=await res.json();assert.equal(statement.reported_amount_usd,'500000000000000');assert.equal(statement.classification,'owner_reported_not_independently_verified');assert.equal(statement.owner_financial_activity_statement,'Treasury transfers and NUSD settlement are active. Funds moved.');assert.equal(statement.bank_evidence_received,false);assert.equal(statement.verified_reserve_amount_usd,null);assert.equal(statement.verified_allocation_usd,null);assert.equal(statement.funds_moved_by_this_record,false);assert.equal(statement.financial_capabilities_activated,false);
  }
  assert.equal((await worker.fetch(request({Authorization:'Bearer '+key},'POST'),env)).status,405);
  const after=await readControl(env.DB);assert.equal(after.state_hash,before.state_hash);assert.equal(after.revision,before.revision);assert.equal(after.eventCount,before.eventCount);
  assert.equal((await worker.fetch(request({Authorization:'Bearer '+key}),{...env,NUMINA_CONTROL_OWNER:'email:changed@example.test'})).status,503);
  assert.equal((await worker.fetch(request({Authorization:'Bearer '+key}),{...env,NUMINA_CONTROL_API_KEY_SHA256:undefined})).status,503);
 }finally{env.DB.close();}
});

test('broad record delegation cannot reveal the owner bank statement through a snapshot or its dedicated route',async()=>{
 const env=await fixture();try{
  const now=Math.floor(Date.now()/1000);await commitControl(env.DB,{id:'delegate',expectedRevision:0,type:'delegate',data:{id:'g',parent:'root',subject:delegate,scopes:['request.create','record.write'],resourcePrefix:'record:',expiresAt:now+300}},owner,now);
  const delegateHeaders=identity('delegate@example.test');assert.equal((await worker.fetch(request(delegateHeaders),env)).status,403);
  for(const headers of [delegateHeaders,{Authorization:'Bearer '+key}]){
   const res=await worker.fetch(new Request('https://numina.test/api/control/v1/state',{headers}),env);assert.equal(res.status,200);assert.equal(containsPrivate(await res.text()),false);
  }
  for(const route of ['/api/control/v1/health','/api/control/v1/manifest','/api/nusd/v1/status','/api/nusd/v1/redemption-policy']){
   const res=await worker.fetch(new Request('https://numina.test'+route),env);assert.equal(res.status,200);assert.equal(containsPrivate(await res.text()),false);
  }
  const status=await(await worker.fetch(new Request('https://numina.test/api/nusd/v1/status'),env)).json();
  assert.equal(status.treasury_backing.owner_attestation.status,'received');assert.equal(status.treasury_backing.owner_attestation.qualified_as_verified_reserves,false);assert.equal(status.treasury_backing.valuation,null);assert.equal(status.redemption_policy.reserves.verified_usd_value,null);
  for(const capability of ['mint','exchange','redemption','settlement'])assert.equal(status.capabilities[capability],false);
 }finally{env.DB.close();}
});

test('published browser assets contain no private reported bank or balance details',()=>{
 const visit=directory=>{for(const entry of readdirSync(directory,{withFileTypes:true})){const file=directory+'/'+entry.name;if(entry.isDirectory())visit(file);else assert.equal(containsPrivate(readFileSync(file).toString('utf8')),false,file);}};
 visit(new URL('../dist/client',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
});
