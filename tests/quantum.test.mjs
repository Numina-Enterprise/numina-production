import test from 'node:test';
import assert from 'node:assert/strict';
import {createQuantumAdapter,prepareQuantumJob,optimizeQuantumJob} from '../integrations/numina/src/quantum.js';
const input=(id='job-1')=>({id,Principal:'owner',Authority:'host-policy',Objective:'Private objective',Intent:{qubits:2,shots:100,gates:[{gate:'H',target:0},{gate:'CX',control:0,target:1}],measure:[0,1]}});
test('optimizer cancels exact adjacent inverses without commuting through other gates',async()=>{
  const i=input();i.Intent.gates=[{gate:'H',target:0},{gate:'H',target:0},{gate:'RX',target:1,angle:.25},{gate:'RX',target:1,angle:-.25},{gate:'CX',control:0,target:1},{gate:'CX',control:0,target:1},{gate:'H',target:0},{gate:'X',target:0},{gate:'H',target:0}];
  const before=JSON.stringify(i),optimized=await optimizeQuantumJob(i,'job-optimized');
  assert.equal(optimized.removedGates,6);assert.deepEqual(optimized.job.request.Intent.gates,i.Intent.gates.slice(-3));
  assert.equal(JSON.stringify(i),before);assert.equal(optimized.hardwareSpeedupMeasured,false);
  await assert.rejects(optimizeQuantumJob(i,i.id),{code:'OPTIMIZED_JOB_REQUIRES_NEW_ID'});
});
test('quantum preparation is bounded, deterministic and does not claim execution',async()=>{
  const a=await prepareQuantumJob(input()),b=await prepareQuantumJob(input());
  assert.equal(a.sha256,b.sha256);assert.match(a.sha256,/^[a-f0-9]{64}$/);assert.equal(a.submitted,false);assert.equal(a.hardwareExecutionVerified,false);
  assert.ok(Object.isFrozen(a.request.Intent.gates[0]));
  const adapter=createQuantumAdapter();assert.equal(adapter.capabilities().backendConfigured,false);
  await assert.rejects(adapter.submit(input()),{code:'QUANTUM_BACKEND_NOT_CONFIGURED'});
});
test('invalid circuits are rejected before provider access',async()=>{
  for(const mutate of [i=>i.Intent.qubits=33,i=>i.Intent.shots=10001,i=>i.Intent.gates=[{gate:'CX',control:0,target:0}],
    i=>i.Intent.gates=[{gate:'RX',target:0,angle:Infinity}],i=>i.Intent.measure=[0,0],i=>i.Intent.gates=[{gate:'X',target:2}],
    i=>i.Intent.extra='secret',i=>i.Intent.gates=[{gate:'H',target:0,angle:0}],i=>i.id='bad id']){
    const i=input();mutate(i);await assert.rejects(prepareQuantumJob(i));
  }
});
test('host authorization gates submission, accepted jobs deduplicate and telemetry excludes objective',async()=>{
  let calls=0;const logs=[];
  const driver={name:'fixture',submit:async()=>{calls++;return {jobId:'provider-1'}},status:async()=>({status:'SUCCEEDED',private:'secret'})};
  await assert.rejects(createQuantumAdapter({driver}).submit(input()),{code:'QUANTUM_AUTHORIZATION_REQUIRED'});
  const adapter=createQuantumAdapter({driver,authorize:async()=>true,emit:e=>logs.push(e)});
  const a=await adapter.submit(input()),b=await adapter.submit(input());assert.deepEqual(a,b);assert.equal(calls,1);
  const changed=input();changed.Intent.shots=1;await assert.rejects(adapter.submit(changed),{code:'QUANTUM_JOB_ID_CONFLICT'});
  const status=await adapter.status('job-1');assert.equal(status.status,'SUCCEEDED');assert.equal(status.resultVerified,false);
  assert.equal(status.hardwareExecutionVerified,false);assert.doesNotMatch(JSON.stringify(logs),/Private objective|host-policy|provider-1|secret/);
});
test('concurrent submission and ambiguous acceptance are bounded and never automatically retried',async()=>{
  let release,calls=0;const pending=new Promise(resolve=>release=resolve);
  const adapter=createQuantumAdapter({maxConcurrent:1,authorize:async()=>true,driver:{name:'fixture',
    submit:async()=>{calls++;await pending;throw Error('provider secret')},status:async()=>({status:'RUNNING'})}});
  const first=adapter.submit(input());await new Promise(resolve=>setImmediate(resolve));
  await assert.rejects(adapter.submit(input()),{code:'QUANTUM_JOB_IN_FLIGHT'});
  await assert.rejects(adapter.submit(input('job-2')),{code:'QUANTUM_CAPACITY_LIMIT'});
  release();await assert.rejects(first,{code:'QUANTUM_SUBMISSION_OUTCOME_UNKNOWN'});
  await assert.rejects(adapter.submit(input()),{code:'QUANTUM_SUBMISSION_OUTCOME_UNKNOWN'});assert.equal(calls,1);
});
