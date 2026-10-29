import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/server/index.js';
import {controlHash,stable} from '../src/control.js';
import {readFileSync} from 'node:fs';
test('production HTTP compute requests redirect before authentication or computation',async()=>{
 const r=await worker.fetch(new Request('http://numinalabs.xyz/api/ops/v1/quantum/measure',{method:'POST'}),{NUMINA_TELEMETRY_LOGS:'false',get NUMINA_CONTROL_OWNER(){throw Error('Authentication before HTTPS')}});
 assert.equal(r.status,308);assert.equal(r.headers.get('location'),'https://numinalabs.xyz/api/ops/v1/quantum/measure');
});
test('assembled Worker exposes authenticated telemetry and simulator without treasury storage',async()=>{
 const env={NUMINA_CONTROL_OWNER:'owner',NUMINA_CONTROL_API_KEY_SHA256:await controlHash('test-only'),NUMINA_TELEMETRY_LOGS:'false',get DB(){throw Error('Unexpected treasury read/write')}};
 const headers={Authorization:'Bearer test-only','Content-Type':'application/json'};
 let r=await worker.fetch(new Request('https://n.test/api/ops/v1/quantum/measure',{method:'POST',headers,body:stable({id:'bundled-run',Principal:'owner',Authority:'NUMINA',Objective:'Verify assembled simulator',Intent:{qubits:1,shots:8,gates:[{gate:'X',target:0}],measure:[0]}})}),env);
 assert.equal(r.status,200);assert.deepEqual((await r.json()).counts,{'1':8});
 r=await worker.fetch(new Request('https://n.test/api/ops/v1/telemetry',{headers}),env);
 const snapshot=await r.json();assert.equal(r.status,200);assert.equal(snapshot.quantum.kind,'classical_simulator');assert.equal(snapshot.quantum.hardwareConnected,false);
 assert.ok(snapshot.window.requests>=1);assert.equal(snapshot.capacity.automaticScalingEnabled,false);
});
test('packaged ownership notices and metric mappings remain aligned',()=>{
 const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
 for(const name of ['OWNERSHIP.md','LICENSE.md','NOTICE.md'])assert.equal(read(name),read('dist/client/downloads/'+name));
 const alignment=JSON.parse(read('dist/client/source-alignment.json'));
 assert.equal(alignment.intellectualProperty.statedOwner,'SK Consulting LLC');assert.equal(alignment.intellectualProperty.registrationVerified,false);
 assert.equal(alignment.treasury.balanceCount,1);assert.equal(alignment.quantum.hardwareExecutionVerified,false);
 assert.ok(read('dist/client/frontier.html').includes('id="runtime-metrics"'));
 assert.doesNotMatch(read('OWNERSHIP.md'),/Â|Ã|â€/);
});
