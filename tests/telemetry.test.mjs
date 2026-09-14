import test from 'node:test';
import assert from 'node:assert/strict';
import {createTelemetry, telemetryRoute} from '../src/telemetry.js';
import {telemetryHttp} from '../src/telemetry-http.js';
import {controlHash} from '../src/control.js';
import worker from '../src/worker.js';
import {EventEmitter} from 'node:events';
import {observeHttp} from '../runtime/vercel-production/lib/http-telemetry.mjs';
test('Node gateway logs exactly once on response finish followed by close',()=>{
 const logs=[],previous=console.log;console.log=value=>logs.push(JSON.parse(value));
 try {const response=new EventEmitter();response.statusCode=200;response.writableFinished=true;response.setHeader=()=>{};
  observeHttp({method:'GET',url:'/private?secret'},response);response.emit('finish');response.emit('close');
  assert.equal(logs.length,1);assert.equal(logs[0].phase,'response_sent');assert.equal(logs[0].aborted,false);assert.doesNotMatch(JSON.stringify(logs),/private|secret/);
 }finally{console.log=previous;}
});

test('routes, methods and logs exclude caller-controlled identity and URL contents',()=>{
  const events=[], m=createTelemetry({emit:e=>events.push(e),clock:()=>10,now:()=>0});
  for(const path of ['/api/control/v1/treasury-documents/private-name?token=secret','/api/app/v1/orders/person@example.test','/unknown/secret']){
    m.begin({path,method:'SECRET'}).finish(503);
  }
  assert.equal(events.length,3);assert.doesNotMatch(JSON.stringify(events),/private-name|token=|person@|SECRET|unknown\/secret/);
  assert.equal(events[0].route,'/api/control/v1/*');assert.equal(events[0].method,'OTHER');
  assert.equal(telemetryRoute('/v3/release/manifest'),'/v4/release/manifest');
});
test('overlapping requests, exactly-once completion, errors and histogram estimates',()=>{
  let time=0;const m=createTelemetry({clock:()=>time,now:()=>time,emit:()=>{}});
  const a=m.begin(),b=m.begin();assert.equal(m.snapshot().activeRequests,2);
  time=80;a.finish(200);a.finish(500);time=1600;b.finish(503);
  const s=m.snapshot();assert.equal(s.completedRequests,2);assert.equal(s.activeRequests,0);assert.equal(s.peakActiveRequests,2);
  assert.equal(s.window.serverErrors,1);assert.equal(s.window.errorRate,.5);assert.equal(s.window.p95UpperBoundMs,2500);
  assert.equal(s.capacity.status,'insufficient_data');assert.equal(s.window.histogram.counts.reduce((a,b)=>a+b),2);
});
test('old windows expire and no data is not a healthy capacity assertion',()=>{
  let t=0;const m=createTelemetry({clock:()=>t,now:()=>t,emit:()=>{}});
  m.begin().finish(429);t=300000;const s=m.snapshot();
  assert.equal(s.window.requests,0);assert.equal(s.window.errorRate,null);assert.equal(s.window.p95UpperBoundMs,null);
  assert.equal(s.capacity.status,'insufficient_data');assert.equal(s.completedRequests,1);
});
test('alerts use measured thresholds and log sink failure cannot fail a request',()=>{
  const m=createTelemetry({clock:()=>0,now:()=>0,emit:()=>{throw Error('sink failure')}});
  for(let i=0;i<100;i++)m.begin().finish(i<5?429:i===5?503:200);
  const s=m.snapshot();assert.equal(s.loggingFailures,100);
  assert.deepEqual(s.capacity.signals,['investigate_server_errors','review_rate_limits_and_capacity']);
});
test('extreme latency is recorded as overflow rather than a fabricated p95',()=>{
  let t=0;const m=createTelemetry({clock:()=>t,now:()=>t,emit:()=>{}}),a=m.begin();
  t=61000;a.finish(504);assert.equal(m.snapshot().window.p95UpperBoundMs,null);assert.equal(m.snapshot().window.p95AboveLargestBucket,true);
});
test('telemetry requires existing owner authentication, is read-only and is not cached',async()=>{
  const env={NUMINA_CONTROL_OWNER:'owner',NUMINA_CONTROL_API_KEY_SHA256:await controlHash('test-only'),get DB(){throw Error('Telemetry must not touch treasury storage')}};
  assert.equal((await telemetryHttp(new Request('https://n.test/api/ops/v1/telemetry'),env)).status,401);
  const auth={Authorization:'Bearer test-only'};
  const r=await telemetryHttp(new Request('https://n.test/api/ops/v1/telemetry',{headers:auth}),env);
  assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/private, no-store/);
  assert.equal((await r.json()).scope,'current_process_only');
  assert.equal((await telemetryHttp(new Request('https://n.test/api/ops/v1/telemetry',{method:'POST',headers:auth}),env)).status,405);
  assert.equal((await telemetryHttp(new Request('https://n.test/api/ops/v1/telemetry',{headers:{'oai-authenticated-user-id':'x','oai-authenticated-user-email':'other@example.test'}}),env)).status,403);
});
test('Worker keeps response bytes and error status with metrics enabled',async()=>{
  const env={NUMINA_TELEMETRY_LOGS:'false',ASSETS:{fetch:async()=>new Response('same bytes',{status:201})}};
  const r=await worker.fetch(new Request('https://n.test/asset'),env);
  assert.equal(r.status,201);assert.equal(await r.text(),'same bytes');assert.ok(r.headers.get('x-request-id'));
  env.ASSETS.fetch=async()=>{throw Error('secret')};
  const failed=await worker.fetch(new Request('https://n.test/asset'),env);
  assert.equal(failed.status,503);assert.doesNotMatch(await failed.text(),/secret/);
});
