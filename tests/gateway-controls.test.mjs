import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const gateway=require('../runtime/vercel-production/lib/numina.js');
const providers=require('../runtime/vercel-production/api/providers.js');
const submit=require('../runtime/vercel-production/api/execution-submit.js');
const {requestControls}=require('../runtime/vercel-production/lib/frontier-handler.js');
const settings=['NUMINA_REAL_FUNDS_ENABLED','NUMINA_PUBLIC_EXECUTION_API_ENABLED','NUMINA_LIVE_PROVIDER_SUBMITTER_ENABLED'];
const enabledEnv=Object.fromEntries(settings.map(name=>[name,'true']));
const approvedRequest={action:'transfer',policy:{economic_execution_allowed:true,require_human_approval:true,human_approval_granted:true}};
const signingReady=()=>true; // Isolated readiness fixture; no signing receipt is produced.
function closed(effective){for(const name of ['real_funds_enabled','public_execution_api_enabled','live_provider_submitter_enabled','execution_authorized','live_submission_enabled','public_execution_route_exposed'])assert.equal(effective[name],false,name);}
function capture(){return {statusCode:0,headers:{},setHeader(name,value){this.headers[name]=value;},end(value){this.body=JSON.parse(value);}};}
async function withClosedEnvironment(fn){
  const names=[...settings,'NUMINA_RUNTIME_SIGNING_KEY_DER_B64'],previous=Object.fromEntries(names.map(name=>[name,process.env[name]]));
  try{for(const name of names)delete process.env[name];await fn();}
  finally{for(const name of names){if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name];}}
}

test('recorded owner intent cannot enable missing, false or malformed configuration',()=>{
  for(const name of settings)for(const value of [undefined,'false','invalid']){
    const env={...enabledEnv};if(value===undefined)delete env[name];else env[name]=value;
    const configured=gateway.controls({env,signingReady}),effective=gateway.ownerControls(configured);
    closed(effective);
    assert.equal(effective.intended_owner_authorization.record.execution_authorized,true);
    assert.equal(effective.intended_owner_authorization.scope,'RECORDED_OWNER_INTENT_NOT_EFFECTIVE_RUNTIME_CONTROLS');
    assert.equal(gateway.evaluate(approvedRequest,configured).execution_permitted,false);
  }
});

test('missing and non-pinned signing identities keep configured submission closed',()=>{
  const {privateKey}=generateKeyPairSync('ed25519');
  for(const key of [undefined,'invalid',privateKey.export({format:'der',type:'pkcs8'}).toString('base64')]){
    const env={...enabledEnv};if(key!==undefined)env.NUMINA_RUNTIME_SIGNING_KEY_DER_B64=key;
    const configured=gateway.controls({env});
    assert.equal(configured.runtime_signing_ready,false);
    closed(gateway.ownerControls(configured));
  }
});

test('explicit controls and verified readiness enable only the shipped Arc Testnet scope',()=>{
  const configured=gateway.controls({env:enabledEnv,signingReady});
  const effective=gateway.ownerControls(configured),manifest=gateway.executionManifest({runtimeControls:configured});
  assert.equal(effective.live_submission_enabled,true);
  assert.equal(gateway.evaluate(approvedRequest,configured).execution_permitted,true);
  assert.equal(manifest.status,'CONFIGURED_ARC_TESTNET_ENABLED');
  assert.deepEqual(manifest.supported_live_providers,['arc']);
  assert.equal(manifest.pre_signed_provider_submitter_shipped,true);
  assert.equal(manifest.production_treasury_linked,false);
  assert.equal(manifest.provider_execution_verified,false);
  assert.equal(manifest.external_execution_performed,false);
});

test('funds and execution manifests separate configured availability from recorded intent and token presence',()=>{
  const runtimeControls=gateway.controls({env:{},signingReady});
  const funds=gateway.fundsManifest({runtimeControls}),execution=gateway.executionManifest({runtimeControls,credentialedProviderSubmitterAvailable:true});
  for(const manifest of [funds,execution]){
    assert.equal(manifest.status,'CONTROL_GATES_CLOSED');
    assert.equal(manifest.intended_owner_authorization.record.funds_enabled,true);
    assert.equal(manifest.production_treasury_linked,false);
  }
  assert.equal(funds.real_funds_enabled,false);
  assert.equal(execution.live_submission_enabled,false);
  assert.deepEqual(execution.supported_live_providers,[]);
  assert.deepEqual(execution.shipped_submission_providers,['arc']);
  assert.equal(execution.credentialed_provider_submitter_configured,true);
  assert.equal(execution.credentialed_provider_submitter_available,false);
});

test('authenticated owner controls retain closed runtime configuration',async()=>withClosedEnvironment(async()=>{
  closed(requestControls(true));
  assert.equal(gateway.evaluate(approvedRequest).execution_permitted,false);
}));

test('public provider catalog describes shipped testnet code without claiming current execution availability',async()=>withClosedEnvironment(async()=>{
  const res=capture();await providers({method:'GET',url:'/v1/execution/providers'},res);
  assert.equal(res.statusCode,200);
  const catalog=res.body.payload,arc=catalog.providers.find(provider=>provider.provider==='arc');
  assert.equal(arc.live_adapter_shipped,true);
  assert.equal(arc.live_submission.implementation_shipped,true);
  assert.equal(arc.live_submission.network,'Arc Testnet');
  assert.equal(arc.live_submission.available,false);
  assert.equal(arc.production_treasury_linked,false);
  assert.equal(catalog.live_submission_route_exposed,false);
  assert.equal(catalog.live_submission_provider,null);
  assert.equal(catalog.shipped_submission_provider,'arc');
  assert.equal(catalog.provider_execution_verified,false);
  assert.equal(catalog.external_execution_performed,false);
}));

test('gateway submission fails before signing or network access when runtime gates are closed',async()=>withClosedEnvironment(async()=>{
  const previousFetch=globalThis.fetch,calls=[];
  try{
    globalThis.fetch=async()=>{calls.push(true);throw Error('Network access forbidden in this test');};
    const res=capture();await submit({method:'POST',body:{}},res);
    assert.equal(res.statusCode,400);
    assert.equal(res.body.error,'LIVE_SUBMISSION_CONTROL_GATE_CLOSED');
    assert.equal(res.body.external_execution_performed,false);
    assert.equal(calls.length,0);
  }finally{globalThis.fetch=previousFetch;}
}));
