import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {database} from '../scripts/sqlite.mjs';import {appHttp} from '../src/app-http.js';
const migration=['0001_useful_black_crow.sql','0002_chief_rachel_grey.sql','0006_command_center_events.sql'].flatMap(name=>readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8').split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean));
const owner={'oai-authenticated-user-id':'user-owner','oai-authenticated-user-email':'owner@example.test'},customer={'oai-authenticated-user-id':'user-customer','oai-authenticated-user-email':'customer@example.test'};
async function fixture(){const db=database();for(const sql of migration)await db.prepare(sql).run();return {DB:db,NUMINA_CONTROL_OWNER:'email:owner@example.test',NUMINA_COMMAND_CENTER_STRIPE_SECRET:'whsec_test_only_not_production',NUMINA_COMMAND_CENTER_SECRET:'cc_test_only_not_production'};}
async function hmac(secret,raw,time){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(time+'.'+raw))).toString('hex');}
async function post(env,raw,headers){const r=await appHttp(new Request('https://numina.test/api/app/v1/command-center/webhook',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:raw}),env);return {status:r.status,body:await r.json()};}
async function stripePost(env,event,options={}){const raw=typeof event==='string'?event:JSON.stringify(event),time=options.time??Math.floor(Date.now()/1000);const sig=options.signature??await hmac(env.NUMINA_COMMAND_CENTER_STRIPE_SECRET,raw,time);return post(env,raw,{'Stripe-Signature':`t=${time},v1=${sig}`});}
async function internalPost(env,event,options={}){const raw=typeof event==='string'?event:JSON.stringify(event),time=options.time??Math.floor(Date.now()/1000);const headers=options.omitSignature?{}:{'X-Numina-Command-Center-Signature':`t=${time},v1=${options.signature??await hmac(env.NUMINA_COMMAND_CENTER_SECRET,raw,time)}`};return post(env,raw,headers);}
async function feed(env,identity=owner,query=''){const r=await appHttp(new Request('https://numina.test/api/app/v1/command-center/events'+query,{headers:identity}),env);return {status:r.status,body:await r.json()};}
async function view(env,identity=owner){const r=await appHttp(new Request('https://numina.test/api/app/v1/command-center',{headers:identity}),env);return {status:r.status,text:await r.text(),contentType:r.headers.get('content-type')};}
function stripeEvent(overrides={}){return {id:'evt_'+crypto.randomUUID().replaceAll('-',''),type:'checkout.session.completed',livemode:true,created:Math.floor(Date.now()/1000),account:'acct_1UEEPnQdJat0efmT',data:{object:{id:'cs_live_'+crypto.randomUUID().replaceAll('-',''),object:'checkout.session'}},...overrides};}
function internalEvent(source,overrides={}){return {source,type:source+'.notice',event_id:source+'-'+crypto.randomUUID(),summary:source+' notice',payload:{detail:'test'},...overrides};}

test('verified Stripe events are logged and visible in the operator feed and view',async()=>{
 const env=await fixture();try{
  const event=stripeEvent(),payout=stripeEvent({type:'payout.created',data:{object:{id:'po_live_'+crypto.randomUUID().replaceAll('-',''),object:'payout'}}});
  assert.deepEqual((await stripePost(env,event)).body,{received:true,matched:true});
  assert.deepEqual((await stripePost(env,payout)).body,{received:true,matched:true});
  const listed=await feed(env);assert.equal(listed.status,200);assert.equal(listed.body.events.length,2);
  assert.equal(listed.body.events[0].source,'stripe');assert.equal(listed.body.events[0].type,'checkout.session.completed');assert.equal(listed.body.events[0].event_id,event.id);assert.match(listed.body.events[0].summary,/checkout\.session\.completed/);
  assert.equal(listed.body.events[1].type,'payout.created');assert.equal(listed.body.next,null);
  const page=await view(env);assert.equal(page.status,200);assert.match(page.contentType,/text\/html/);assert.match(page.text,/checkout\.session\.completed/);assert.match(page.text,/payout\.created/);assert.match(page.text,/Singularity Protocol/);
  assert.equal((await feed(env,customer)).status,403);assert.equal((await view(env,customer)).status,403);
 }finally{env.DB.close();}
});

test('unsigned, tampered and stale Stripe events are rejected before anything is stored',async()=>{
 const env=await fixture();try{
  const event=stripeEvent();
  assert.equal((await post(env,JSON.stringify(event),{})).status,401);
  assert.equal((await stripePost(env,event,{signature:'0'.repeat(64)})).status,400);
  assert.equal((await stripePost(env,event,{time:Math.floor(Date.now()/1000)-301})).status,400);
  const other=stripeEvent(),time=Math.floor(Date.now()/1000);
  assert.equal((await post(env,JSON.stringify(other),{'Stripe-Signature':`t=${time},v1=${await hmac(env.NUMINA_COMMAND_CENTER_STRIPE_SECRET,JSON.stringify(event),time)}`})).status,400);
  assert.equal((await post(env,JSON.stringify(event),{'Stripe-Signature':`t=${time},v1=${await hmac(env.NUMINA_COMMAND_CENTER_STRIPE_SECRET,JSON.stringify(event),time)}`,'X-Numina-Command-Center-Signature':`t=${time},v1=${await hmac(env.NUMINA_COMMAND_CENTER_SECRET,JSON.stringify(event),time)}`})).status,400);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM numina_command_center_events').first()).n,0);
 }finally{env.DB.close();}
});

test('malformed Stripe payloads are rejected after verification',async()=>{
 const env=await fixture();try{
  assert.equal((await stripePost(env,'{not json')).body.error,'INVALID_JSON');
  assert.equal((await stripePost(env,stripeEvent({livemode:false}))).status,400);
  assert.equal((await stripePost(env,stripeEvent({account:'acct_someoneElse'}))).status,400);
  assert.equal((await stripePost(env,stripeEvent({id:'not-an-event-id'}))).status,400);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM numina_command_center_events').first()).n,0);
 }finally{env.DB.close();}
});

test('duplicate Stripe events replay once and conflicting bodies are rejected',async()=>{
 const env=await fixture();try{
  const event=stripeEvent();
  assert.deepEqual((await stripePost(env,event)).body,{received:true,matched:true});
  assert.deepEqual((await stripePost(env,event)).body,{received:true,replayed:true});
  const conflict=structuredClone(event);conflict.data.object.id='cs_live_conflicting';
  assert.equal((await stripePost(env,conflict)).status,409);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM numina_command_center_events').first()).n,1);
 }finally{env.DB.close();}
});

test('verified internal events are logged per source',async()=>{
 const env=await fixture();try{
  for(const source of ['treasury','quantum','gmail']){
   const event=internalEvent(source,{type:source+'.gap_changed',summary:source+' gap changed'});
   assert.deepEqual((await internalPost(env,event)).body,{received:true,matched:true});
  }
  const listed=await feed(env);assert.equal(listed.body.events.length,3);
  assert.deepEqual(listed.body.events.map(e=>e.source),['treasury','quantum','gmail']);
  assert.equal(listed.body.events[0].payload.detail,'test');
 }finally{env.DB.close();}
});

test('internal events require a valid HMAC and a strict envelope',async()=>{
 const env=await fixture();try{
  assert.equal((await internalPost(env,internalEvent('treasury'),{omitSignature:true})).status,401);
  assert.equal((await internalPost(env,internalEvent('treasury'),{signature:'0'.repeat(64)})).status,400);
  assert.equal((await internalPost(env,internalEvent('treasury'),{time:Math.floor(Date.now()/1000)-301})).status,400);
  assert.equal((await internalPost(env,{...internalEvent('treasury'),source:'stripe'})).status,400);
  assert.equal((await internalPost(env,{...internalEvent('treasury'),source:'unknown'})).status,400);
  assert.equal((await internalPost(env,{...internalEvent('treasury'),event_id:''})).status,400);
  assert.equal((await internalPost(env,{...internalEvent('treasury'),payload:undefined})).status,400);
  assert.equal((await internalPost(env,{...internalEvent('treasury'),payload:{pad:'x'.repeat(20000)}})).status,413);
  assert.equal((await internalPost(env,'{not json')).body.error,'INVALID_JSON');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM numina_command_center_events').first()).n,0);
 }finally{env.DB.close();}
});

test('feed pagination, cursors and the HTML view escape untrusted summaries',async()=>{
 const env=await fixture();try{
  const first=internalEvent('treasury',{summary:'Treasury gap 8 changed <b>&"quoted"'});
  await internalPost(env,first);await internalPost(env,internalEvent('quantum'));await internalPost(env,internalEvent('gmail'));
  const page=await feed(env,owner,'?limit=2');assert.equal(page.body.events.length,2);assert.ok(page.body.next);
  const rest=await feed(env,owner,'?after='+page.body.next);assert.equal(rest.body.events.length,1);assert.equal(rest.body.next,null);
  assert.equal((await feed(env,owner,'?limit=0')).status,400);assert.equal((await feed(env,owner,'?after=abc')).status,400);assert.equal((await feed(env,owner,'?limit=101')).status,400);
  const shown=await view(env);assert.match(shown.text,/&lt;b&gt;&amp;&quot;quoted&quot;/);assert.doesNotMatch(shown.text,/<b>&"quoted"/);
  const r=await appHttp(new Request('https://numina.test/api/app/v1/command-center/events',{method:'POST',headers:owner}),env);assert.equal(r.status,405);
 }finally{env.DB.close();}
});

test('retention keeps only the newest 1000 events',async()=>{
 const env=await fixture();try{
  for(let i=0;i<1001;i++){
   if(i%100===0)await env.DB.prepare('DELETE FROM numina_app_rate').run();
   const r=await internalPost(env,internalEvent('treasury',{event_id:'treasury-'+i}));
   assert.equal(r.status,200,JSON.stringify(r.body));
  }
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM numina_command_center_events').first()).n,1000);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM numina_command_center_events WHERE event_id=?').bind('treasury-0').first()).n,0);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM numina_command_center_events WHERE event_id=?').bind('treasury-1000').first()).n,1);
 }finally{env.DB.close();}
});

test('a missing command-center secret fails closed for both senders',async()=>{
 const env=await fixture();try{
  delete env.NUMINA_COMMAND_CENTER_STRIPE_SECRET;delete env.NUMINA_COMMAND_CENTER_SECRET;
  assert.equal((await stripePost(env,stripeEvent(),{signature:'0'.repeat(64)})).status,503);
  assert.equal((await internalPost(env,internalEvent('treasury'),{signature:'0'.repeat(64)})).status,503);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM numina_command_center_events').first()).n,0);
 }finally{env.DB.close();}
});
