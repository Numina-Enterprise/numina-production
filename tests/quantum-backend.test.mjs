import test from 'node:test';
import assert from 'node:assert/strict';
import {measureNuminaCircuit} from '../src/quantum-backend.js';
import {optimizeQuantumJob} from '../integrations/numina/src/quantum.js';
import {quantumHttp} from '../src/quantum-http.js';
import {controlHash,stable} from '../src/control.js';
const job=(gates,measure=[0,1])=>({id:'measurement-1',Principal:'owner',Authority:'NUMINA',Objective:'Circuit measurement',Intent:{qubits:2,shots:1024,gates,measure}});
test('connected simulator measures a Bell circuit without non-correlated outcomes',async()=>{
 const r=await measureNuminaCircuit(job([{gate:'H',target:0},{gate:'CX',control:0,target:1}]));
 assert.equal(r.shots,1024);assert.equal(Object.values(r.counts).reduce((a,b)=>a+b),1024);
 assert.ok(Object.keys(r.counts).every(k=>['00','11'].includes(k)));
 assert.ok(Math.abs(r.idealProbabilities['00']-.5)<1e-12);assert.ok(Math.abs(r.idealProbabilities['11']-.5)<1e-12);
 assert.equal(r.hardwareExecution,false);assert.equal(r.treasuryWrites,false);
});
test('basis ordering, complex gates and rotations preserve ideal probabilities',async()=>{
 let r=await measureNuminaCircuit(job([{gate:'X',target:0}], [1,0]));assert.deepEqual(r.counts,{'01':1024});
 for(const gate of ['X','Y','RX','RY']){
  const item={gate,target:0,...(gate.length===2?{angle:Math.PI}:{})};
  r=await measureNuminaCircuit(job([item],[0]));assert.ok(Math.abs(r.idealProbabilities['1']-1)<1e-12);
 }
 for(const gate of ['Z','S','T','RZ']){
  const item={gate,target:0,...(gate==='RZ'?{angle:Math.PI/2}:{})};
  r=await measureNuminaCircuit(job([{gate:'H',target:0},item],[0]));
  assert.ok(Math.abs(r.idealProbabilities['0']-.5)<1e-12);
 }
});
test('optimization keeps actual ideal measurement probabilities unchanged',async()=>{
 const i=job([{gate:'H',target:0},{gate:'H',target:0},{gate:'H',target:1},{gate:'CX',control:1,target:0}]);
 const optimized=await optimizeQuantumJob(i,'optimized-1');const {schema,...request}=optimized.job.request;
 const a=await measureNuminaCircuit(i),b=await measureNuminaCircuit(request);
 for(const key of new Set([...Object.keys(a.idealProbabilities),...Object.keys(b.idealProbabilities)]))
  assert.ok(Math.abs((a.idealProbabilities[key]??0)-(b.idealProbabilities[key]??0))<1e-12);
 assert.equal(optimized.removedGates,2);
});
test('simulation resource limits reject oversized requests',async()=>{
 const i=job([]);i.Intent.qubits=9;
 await assert.rejects(measureNuminaCircuit(i),{code:'SIMULATOR_LIMIT_EXCEEDED'});
});
test('authenticated endpoint binds Principal and Authority and protects session writes',async()=>{
 const env={NUMINA_CONTROL_OWNER:'owner',NUMINA_CONTROL_API_KEY_SHA256:await controlHash('test-only'),NUMINA_TELEMETRY_LOGS:'false',get DB(){throw Error('No treasury access')}};
 const request=(body,auth=true)=>new Request('https://n.test/api/ops/v1/quantum/measure',{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer test-only'}:{})},body:stable(body)});
 assert.equal((await quantumHttp(request(job([]),false),env)).status,401);
 const wrong=job([]);wrong.Principal='other';assert.equal((await quantumHttp(request(wrong),env)).status,403);
 const r=await quantumHttp(request(job([{gate:'X',target:1}])),env);
 assert.equal(r.status,200);assert.deepEqual((await r.json()).counts,{'01':1024});
 assert.match(r.headers.get('cache-control'),/private, no-store/);
 env.NUMINA_QUANTUM_SIMULATOR_ENABLED='false';assert.equal((await quantumHttp(request(job([])),env)).status,503);
});
