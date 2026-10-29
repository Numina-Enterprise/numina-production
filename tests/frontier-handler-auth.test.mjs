import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const {
  makeFrontierHandler,
  ownerBearerAuthorized,
  requestControls
}=require('../runtime/vercel-production/lib/frontier-handler.js');
const {evaluate}=require('../runtime/vercel-production/lib/numina.js');

const sha=value=>crypto.createHash('sha256').update(value,'utf8').digest('hex');

function responseCapture(){
  return {
    statusCode:0,
    headers:{},
    body:null,
    setHeader(name,value){this.headers[name.toLowerCase()]=value;},
    end(value){this.body=JSON.parse(value);}
  };
}

test('owner bearer authorization is exact, hashed and fails closed on malformed configuration',()=>{
  const token='numina-test-owner-token';
  const env={NUMINA_CONTROL_API_KEY_SHA256:sha(token)};
  assert.equal(ownerBearerAuthorized({headers:{authorization:'Bearer '+token}},{env}),true);
  assert.equal(ownerBearerAuthorized({headers:{authorization:'Bearer wrong'}},{env}),false);
  assert.equal(ownerBearerAuthorized({headers:{}},{env}),false);
  assert.equal(ownerBearerAuthorized({headers:{authorization:'Bearer '+token}},{env:{NUMINA_CONTROL_API_KEY_SHA256:'invalid'}}),false);
});

test('unauthenticated economic evaluation remains closed even when process environment is permissive',()=>{
  const priorFunds=process.env.NUMINA_REAL_FUNDS_ENABLED;
  const priorPublic=process.env.NUMINA_PUBLIC_EXECUTION_API_ENABLED;
  try{
    process.env.NUMINA_REAL_FUNDS_ENABLED='true';
    process.env.NUMINA_PUBLIC_EXECUTION_API_ENABLED='true';
    const controls=requestControls(false);
    assert.equal(controls.real_funds_enabled,false);
    assert.equal(controls.public_execution_api_enabled,false);
    const decision=evaluate({
      action:'transfer',
      policy:{economic_execution_allowed:true,require_human_approval:true,human_approval_granted:true}
    },controls);
    assert.equal(decision.decision,'CONTROL_GATE_CLOSED');
    assert.equal(decision.execution_permitted,false);
  }finally{
    if(priorFunds===undefined)delete process.env.NUMINA_REAL_FUNDS_ENABLED;else process.env.NUMINA_REAL_FUNDS_ENABLED=priorFunds;
    if(priorPublic===undefined)delete process.env.NUMINA_PUBLIC_EXECUTION_API_ENABLED;else process.env.NUMINA_PUBLIC_EXECUTION_API_ENABLED=priorPublic;
  }
});

test('signed handoff and evidence binding endpoints require owner bearer before signing',async()=>{
  for(const kind of ['execution-prepare','evidence-bind']){
    const res=responseCapture();
    await makeFrontierHandler(kind)({method:'POST',headers:{},body:{}},res);
    assert.equal(res.statusCode,401);
    assert.deepEqual(res.body,{error:'OWNER_AUTH_REQUIRED'});
    assert.equal(res.headers['cache-control'],'no-store');
  }
});
