import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import built from '../dist/server/index.js';
import {database} from '../scripts/sqlite.mjs';
import {bootstrapControl} from '../src/control-store.js';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {privateBankRouteConfiguration} from '../src/bank-route-model.js';

test('FINAL pins and all maintained ACH projections preserve the latest execution-only instruction',()=>{
  execFileSync(process.execPath,[fileURLToPath(new URL('../scripts/check-final-build.mjs',import.meta.url))]);
});

test('private bank configuration does not turn routing or native settlement into ACH evidence',()=>{
  for(const env of [{},{NUMINA_BOFA_SAVINGS_ACCOUNT:'123453486',NUMINA_BOFA_ACH_ROUTING_NUMBER:'073000176'}]){
    const route=privateBankRouteConfiguration(env);
    assert.equal(route.identity,'NUMINA');
    assert.equal(route.treasuryIdentity,'NUMINA');
    assert.equal(route.achExecutionScope.treasuryIdentity,'NUMINA NATIVE TREASURY');
    assert.equal(route.achExecutionScope.endpointIdentity,'SK Consulting LLC');
    assert.equal(route.achSubmissionEnabled,false);
    assert.equal(route.achOriginatorSubmissionPerformed,false);
    assert.equal(route.externalAchOriginatorConfirmed,false);
    assert.equal(route.networkSubmissionVerified,false);
    assert.equal(route.settlementPerformed,false);
    assert.equal(route.settlementStatus,'UNVERIFIED');
    assert.equal(route.achTraceNumber,null);
    assert.equal(route.providerConfirmationId,null);
    assert.equal(route.nativeSettlementEvidenceScope,'NUMINA_NATIVE_TREASURY_JOURNAL_SNAPSHOT');
    assert.equal(route.nativeSettlementStatus,'UNVERIFIED');
    assert.equal(route.achInstructionStatus,'PREPARED');
    assert.equal(route.treasuryInstructionSubmissionPerformed,false);
    assert.equal(route.nativeBalance,null);
    assert.equal(route.backingVerified,null);
  }
});

test('FINAL originals retain exact bytes behind owner access and are absent from public static delivery',async t=>{
  const source=readFileSync(new URL('../public/final-build.json',import.meta.url));
  const owner='email:ach-fixture@example.test',token='local-ach-privacy-fixture',DB=database();t.after(()=>DB.close());
  await bootstrapControl(DB,owner,Math.floor(Date.now()/1000));
  const env={DB,NUMINA_TELEMETRY_LOGS:'false',NUMINA_CONTROL_OWNER:owner,NUMINA_CONTROL_API_KEY_SHA256:createHash('sha256').update(token).digest('hex')};
  for(const path of ['/final-build.json','/downloads/NUMINA-FINAL-BUILD.json']){
    assert.equal(existsSync(new URL('../dist/client'+path,import.meta.url)),false,path);
    const request=(method='GET',auth=false)=>new Request('https://numina.test'+path,{method,headers:auth?{Authorization:'Bearer '+token}:{}});
    for(const method of ['GET','HEAD'])assert.equal((await built.fetch(request(method),env)).status,401,path);
    assert.equal((await built.fetch(request('GET',true),{...env,NUMINA_REVIEW_SESSION:true})).status,403,path);
    const response=await built.fetch(request('GET',true),env);assert.equal(response.status,200,path);
    assert.match(response.headers.get('Cache-Control'),/private.*no-store/);assert.equal(response.headers.get('CDN-Cache-Control'),'no-store');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),source,path);
  }
});
