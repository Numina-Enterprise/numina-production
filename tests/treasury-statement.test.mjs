import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {database} from '../scripts/sqlite.mjs';
import {bootstrapControl,readControl,commitControl} from '../src/control-store.js';
import {controlHash} from '../src/control.js';
import worker from '../src/worker.js';
import {NUSD_POLICY} from '../src/nusd-http.js';
const owner='email:owner@example.test',delegate='email:delegate@example.test',key='local-owner-test-key';
const path='/api/control/v1/treasury-attestation';
const identity=email=>({'oai-authenticated-user-id':'platform-test-user','oai-authenticated-user-email':email});
const request=(headers={},method='GET')=>new Request('https://numina.test'+path,{headers,method});
const containsPrivate=s=>/(?<![0-9])500000000000000(?![0-9])|(?<![0-9,])500,000,000,000,000(?![0-9,])|Bank of America|Treasury transfers and NUSD settlement are active\. Funds moved\./.test(s);
async function fixture(){const DB=database(),now=Math.floor(Date.now()/1000);await bootstrapControl(DB,owner,now);return {DB,NUMINA_CONTROL_OWNER:owner,NUMINA_CONTROL_API_KEY_SHA256:await controlHash(key)};}

test('legacy owner statement is replaced by the private canonical Numina treasury route',async()=>{
 const env=await fixture();try{
  const before=await readControl(env.DB);
  for(const headers of [{},{Authorization:'Bearer invalid'},identity('other@example.test')]){
   const res=await worker.fetch(request(headers),env);assert.equal(res.status,headers['oai-authenticated-user-email']?403:401);assert.equal(containsPrivate(await res.text()),false);
  }
  for(const headers of [{Authorization:'Bearer '+key},identity('owner@example.test')]){
   const res=await worker.fetch(request(headers),env);assert.equal(res.status,308);assert.equal(res.headers.get('Location'),'/api/control/v1/treasury');assert.equal(res.headers.get('Cache-Control'),'private, no-store');assert.equal(containsPrivate(await res.text()),false);
  }
  assert.equal((await worker.fetch(request({Authorization:'Bearer '+key},'POST'),env)).status,405);
  const after=await readControl(env.DB);assert.equal(after.state_hash,before.state_hash);assert.equal(after.revision,before.revision);
  assert.equal((await worker.fetch(request({Authorization:'Bearer '+key}),{...env,NUMINA_CONTROL_OWNER:'email:changed@example.test'})).status,503);
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
   const res=await worker.fetch(new Request('https://numina.test'+route),env);assert.equal(res.status,200);
   const value=await res.json();
   if(route==='/api/nusd/v1/status'){
    // Static public review, receipt and native-model descriptors contain published
    // amounts/rail labels. They must match those descriptors exactly, never a
    // private account response or an owner statement loaded from storage.
    assert.deepEqual(value,NUSD_POLICY);
    for(const field of ['approved_review','simulation','contract_record','conversion_workflow','provider_routing']){
      assert.deepEqual(value[field],NUSD_POLICY[field]);delete value[field];
    }
   }
   assert.equal(containsPrivate(JSON.stringify(value)),false);
  }
  const noPrivateRead={...env,get DB(){throw new Error('Private records must not be read for public NUSD status');}};
  assert.equal((await worker.fetch(new Request('https://numina.test/api/nusd/v1/status'),noPrivateRead)).status,200);
  const status=await(await worker.fetch(new Request('https://numina.test/api/nusd/v1/status'),env)).json();
  assert.equal(status.treasury_backing.owner_attestation.status,'received');assert.equal(status.treasury_backing.owner_attestation.qualified_as_verified_reserves,false);assert.equal(status.treasury_backing.valuation,null);assert.equal(status.redemption_policy.reserves.verified_usd_value,null);
  for(const capability of ['mint','exchange','redemption','settlement'])assert.equal(status.capabilities[capability],false);
 }finally{env.DB.close();}
});

test('published assets contain no owner test credential or unsupported transfer confirmation',()=>{
 const containsPrivate=s=>s.includes(key)||s.includes('Treasury transfers and NUSD settlement are active. Funds moved.');
 const visit=directory=>{for(const entry of readdirSync(directory,{withFileTypes:true})){const file=directory+'/'+entry.name;if(entry.isDirectory())visit(file);else assert.equal(containsPrivate(readFileSync(file).toString('utf8')),false,file);}};
 visit(new URL('../dist/client',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
});
