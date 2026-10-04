import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceSessionTarget,workspaceSignInUrl,NUMINA_SESSION_ORIGIN} from '../public/workspace-session.js';
import worker from '../src/worker.js';
import {database} from '../scripts/sqlite.mjs';
import {bootstrapControl,readControl} from '../src/control-store.js';

test('Numina interactive entries reuse the existing hosted session and retain context',async()=>{
 for(const host of ['numinalabs.xyz','www.numinalabs.xyz'])for(const [path,target]of [['/app','/app'],['/app.html','/app'],['/control','/control'],['/control.html','/control'],['/frontier','/frontier'],['/control-room','/frontier']]){
  const href='https://'+host+path+'?service=audit#native-treasury-panel';
  assert.equal(workspaceSessionTarget(href),NUMINA_SESSION_ORIGIN+target+'?service=audit#native-treasury-panel');
  const response=await worker.fetch(new Request(href,{headers:{Cookie:'private-fixture'}}),{NUMINA_TELEMETRY_LOGS:'false',get DB(){throw Error('Must not read records');},ASSETS:{fetch(){throw Error('Must not serve a second session surface');}}});
  assert.equal(response.status,307);assert.equal(response.headers.get('Location'),NUMINA_SESSION_ORIGIN+target+'?service=audit#native-treasury-panel');
  assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.has('Set-Cookie'),false);
 }
});
test('session routing leaves API authentication, writes and other origins unchanged',()=>{
 for(const href of ['https://numinalabs.xyz/api/control/v1/treasury','https://numinalabs.xyz/','https://numinalabs.xyz.evil.test/control',NUMINA_SESSION_ORIGIN+'/control','https://numina.test/control'])assert.equal(workspaceSessionTarget(href),null);
 for(const method of ['POST','PUT','DELETE'])assert.equal(workspaceSessionTarget('https://numinalabs.xyz/control',method),null);
});
test('all Numina sign-in continuations share a fixed origin and reject outside destinations',()=>{
 for(const path of ['/control#native-treasury-panel','/frontier','/app?service=audit_enterprise#service-work']){
  const custom=new URL(workspaceSignInUrl('https://numinalabs.xyz'+path,path));assert.equal(custom.origin,NUMINA_SESSION_ORIGIN);assert.equal(custom.searchParams.get('return_to'),path);
  assert.ok(workspaceSignInUrl(NUMINA_SESSION_ORIGIN+path,path).startsWith('/signin-with-chatgpt?'));
 }
 for(const path of ['https://evil.test/app','//evil.test/control','/other'])assert.throws(()=>workspaceSignInUrl('https://numinalabs.xyz/control',path),/Invalid Numina continuation/);
});
test('Numina head reads report the existing singular manifest hash',async()=>{
 const db=database();
 try{
  await bootstrapControl(db,'email:owner@example.test',Math.floor(Date.now()/1000));
  const env={DB:db,NUMINA_TELEMETRY_LOGS:'false'},hash=(await readControl(db)).manifest_hash;
  const head=await worker.fetch(new Request('https://numina.test/api/control/v2/head'),env);assert.equal(head.status,200);assert.equal((await head.json()).manifestHash,hash);
  const discovery=await worker.fetch(new Request('https://numina.test/api/control/v2/discovery-mcp',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://numina.test'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'numina_head',arguments:{}}})}),env);
  assert.equal(discovery.status,200);const result=await discovery.json();assert.equal(JSON.parse(result.result.content[0].text).manifestHash,hash);
 }finally{db.close();}
});


test('generated Numina software routes workspace entries through its verified session origin',async()=>{
 const built=(await import('../dist/server/index.js')).default;
 for(const origin of ['https://numinalabs.xyz','https://www.numinalabs.xyz'])for(const route of ['/app','/control','/frontier']){
  const env={NUMINA_TELEMETRY_LOGS:'false',ASSETS:{fetch(){throw Error('No separate workspace should be served');}}};
  let result=await built.fetch(new Request(origin+route+'?service=audit'),env);
  if(origin==='https://www.numinalabs.xyz'){assert.equal(result.status,301);assert.equal(result.headers.get('Location'),'https://numinalabs.xyz'+route+'?service=audit');result=await built.fetch(new Request(result.headers.get('Location')),env);}
  assert.equal(result.status,307);assert.equal(result.headers.get('Location'),NUMINA_SESSION_ORIGIN+route+'?service=audit');
 }
});
