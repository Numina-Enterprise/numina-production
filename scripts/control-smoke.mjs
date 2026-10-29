import assert from 'node:assert/strict';import {readFileSync,writeFileSync} from 'node:fs';
import {stable,controlHash,initialControlState,reduceControl} from '../src/control.js';
const origin=process.argv[2],key=JSON.parse(readFileSync(process.env.NUMINA_CONTROL_API_KEY_FILE,'utf8')).key,report={origin,startedAt:new Date().toISOString(),checks:[]};
async function call(path,{body,auth=false,headers={},expected=200}={}){const start=Date.now();const r=await fetch(origin+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(auth?{Authorization:'Bearer '+key}:{}),...headers},body:body?stable(body):undefined,signal:AbortSignal.timeout(20000)});const raw=await r.text();let data;try{data=JSON.parse(raw);}catch{data=raw;}report.checks.push({path,status:r.status,expected,ms:Date.now()-start,requestId:r.headers.get('x-request-id'),version:r.headers.get('x-numina-control-version'),contentType:r.headers.get('content-type')});assert.equal(r.status,expected,`${path}: ${raw.slice(0,300)}`);return data;}
try{
  const page=await call('/');assert.match(page,/One state\. Verified action\./);
  for(const path of ['/control.js','/control.css','/numina-labs-dark-logo.png'])await call(path);
  let healthResponse=await fetch(origin+'/api/control/v1/health');let initial=await healthResponse.json();
  if(initial.error==='CONTROL_NOT_INITIALIZED')await call('/api/control/v1/bootstrap',{body:{initialize:true},auth:true,expected:201});else assert.equal(healthResponse.status,200,stable(initial));
  const health=await call('/api/control/v1/health');assert.equal(health.status,'ready');assert.ok(Object.values(health.checks).every(Boolean));assert.equal(health.externalExecution,false);
  await call('/api/control/v1/state',{expected:401});
  await call('/api/control/v1/state',{headers:{'oai-authenticated-user-id':'forged','oai-authenticated-user-email':'skott34@gmail.com'},expected:401});
  const manifest=await call('/api/control/v1/manifest');assert.equal(manifest.adapters[0].id,'internal.record.v1');
  let state=await call('/api/control/v1/state',{auth:true}),revision=state.revision;
  const id='release-'+crypto.randomUUID();
  const send=async(type,data)=>{const command={id:crypto.randomUUID(),expectedRevision:revision,type,data};const result=await call('/api/control/v1/commands',{body:command,auth:true});revision=result.event.revision;return {command,result};};
  await send('request',{id,route:'internal.record.v1',wants:{resource:'record:verification/'+id,payload:'Production deployment verification: internal record only; no external effect.'},requiredEvidence:['release-check']});
  let next=await call('/api/control/v1/next-action',{auth:true});assert.equal(next.decisions.find(x=>x.requestId===id).reason,'MISSING_EVIDENCE');
  await send('attest',{requestId:id,key:'release-check',value:'Authenticated production request and readiness checks passed.',expiresAt:Math.floor(Date.now()/1000)+3600,parents:[]});
  next=await call('/api/control/v1/next-action',{auth:true});const action=next.decisions.find(x=>x.requestId===id).nextAction;assert.ok(action);
  const executed=await send('execute',{requestId:id,actionId:action.actionId});
  const replay=await call('/api/control/v1/commands',{body:executed.command,auth:true});assert.equal(replay.eventHash,executed.result.eventHash);assert.equal(replay.replayed,true);
  await call('/api/control/v1/commands',{body:{id:crypto.randomUUID(),expectedRevision:revision-1,type:'reconcile',data:{}},auth:true,expected:409});
  await call('/api/v0.1/commit',{body:{},expected:410});
  state=await call('/api/control/v1/state',{auth:true});assert.equal(state.state.records.filter(r=>r.requestId===id).length,1);assert.equal(state.decisions.find(x=>x.requestId===id).nextAction,null);
  let cursor=-1,events=[];for(;;){const page=await call('/api/control/v1/journal?after='+cursor,{auth:true});events.push(...page.events);if(page.events.length<100)break;cursor=page.next;}
  let previous=null,replayedState;
  for(const {event,hash} of events){assert.equal(await controlHash(event),hash);assert.equal(event.previous,previous);if(event.revision===0)replayedState=initialControlState(event.actor,event.at);else{const reduced=await reduceControl(replayedState,event.command,event.actor,event.revision-1,event.at);replayedState=reduced.state;assert.equal(await controlHash(reduced.decisions),event.decisionsHash);}assert.equal(await controlHash(replayedState),event.stateHash);previous=hash;}
  assert.equal(await controlHash(replayedState),state.stateHash);
  report.health=await call('/api/control/v1/health');report.journalReplay={verified:true,events:events.length,stateHash:state.stateHash,evidenceHead:previous};report.recordVerification={requestId:id,exactlyOneRecord:true,idempotentReplay:true,staleRevisionRejected:true,anonymousAndSpoofedIdentityRejected:true};report.status='passed';
}catch(e){report.status='failed';report.error=e.message;process.exitCode=1;}
report.finishedAt=new Date().toISOString();writeFileSync(process.argv[3]||'work/production-health.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
