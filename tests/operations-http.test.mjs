import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {readFileSync,existsSync,statSync} from 'node:fs';
import {database} from '../scripts/sqlite.mjs';
import {bootstrapControl,readControl,commitControl,controlManifestView} from '../src/control-store.js';
import {controlHash,stable} from '../src/control.js';
import {frontierVerify} from '../src/frontier.js';
import {CONNECTION_TARGETS} from '../public/connection-model.js';
import sourceWorker from '../src/worker.js';
const owner='email:owner@example.test',token='synthetic-ops-owner-token',sentinel='PRIVATE_NOTICE_SENTINEL_9a2d',path='/api/control/v2/operations/notices';
let sequence=0;
async function fixture(){
 const DB=database(),now=Math.floor(Date.now()/1000);await bootstrapControl(DB,owner,now);const {privateKey,publicKey}=generateKeyPairSync('ed25519');
 return {DB,NUMINA_CONTROL_OWNER:owner,NUMINA_LIVEMODE:'true',NUMINA_CONTROL_API_KEY_SHA256:await controlHash(token),NUMINA_RECEIPT_PRIVATE_JWK:JSON.stringify(privateKey.export({format:'jwk'})),NUMINA_RECEIPT_PUBLIC_JWK:JSON.stringify(publicKey.export({format:'jwk'})),ASSETS:{fetch:async req=>{let file='dist/client'+new URL(req.url).pathname;if(file.endsWith('/'))file+='index.html';if(!existsSync(file)&&existsSync(file+'.html'))file+='.html';return existsSync(file)&&statSync(file).isFile()?new Response(readFileSync(file),{headers:{'Content-Type':file.endsWith('.json')?'application/json':'text/plain'}}):new Response('not found',{status:404});}}};
}
const create=(revision=0)=>({id:'ops-create',expectedRevision:revision,data:{operation:'create',notice:{id:'notice-1',roomIds:['engineering'],templateId:'engineering',templateVersion:1,title:sentinel,body:'Synthetic private test record',severity:'important',dueAt:null,source:{type:'surface',reference:'control-api',observedAt:Math.floor(Date.now()/1000)}}}});
function request(route=path,body,auth=token,headers={}){return new Request('https://numina.test'+route,{method:body?'POST':'GET',headers:{'cf-connecting-ip':'ops-'+(++sequence),...(auth?{Authorization:'Bearer '+auth}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?stable(body):undefined});}
const workers=[['source',sourceWorker]];
if(process.env.OPS_BUILT_TEST==='1')workers.push(['built',(await import('../dist/server/index.js?operations-http')).default]);
for(const [label,worker]of workers){
 test(label+': owner-only route, canonical replay, signed private receipt and unrelated state invariants',async()=>{
  const env=await fixture(),network=globalThis.fetch;let networkCalls=0;globalThis.fetch=async()=>{networkCalls++;throw Error('External request prohibited');};
  try{
   const before=await readControl(env.DB),body=create();
   assert.equal((await worker.fetch(request(path),env)).status,200);
   const response=await worker.fetch(request(path,body),env),value=await response.json();assert.equal(response.status,200,JSON.stringify(value));assert.equal(value.event.result.recorded,true);assert.equal(await frontierVerify(value.receipt,JSON.parse(env.NUMINA_RECEIPT_PUBLIC_JWK)),true);
   assert.equal((await worker.fetch(request(path,body),env)).status,200);assert.equal((await readControl(env.DB)).revision,1);
   const conflict=structuredClone(body);conflict.data.notice.title='Changed';assert.equal((await worker.fetch(request(path,conflict),env)).status,409);
   const stale={id:'stale',expectedRevision:0,data:{operation:'open',noticeId:'notice-1'}};assert.equal((await worker.fetch(request(path,stale),env)).status,409);
   const viewResponse=await worker.fetch(request(),env),view=await viewResponse.json();assert.equal(viewResponse.headers.get('Cache-Control'),'private, no-store');assert.equal(view.notices[0].title,sentinel);assert.equal(view.rooms.length,9);assert.equal(view.templates.length,9);assert.equal(view.sources.length,21);assert.equal(view.counts.total,1);assert.equal(view.delivery,'not_configured');
   const receipt=await worker.fetch(request('/api/control/v2/receipts/ops-create'),env);assert.equal(receipt.status,200);assert.equal(receipt.headers.get('Cache-Control'),'private, no-store');
   const after=await readControl(env.DB);assert.deepEqual(after.manifest.grants,before.manifest.grants);assert.deepEqual(after.manifest.records,before.manifest.records);assert.equal(after.manifest.nativeTreasury,before.manifest.nativeTreasury);assert.equal(networkCalls,0);
  }finally{globalThis.fetch=network;env.DB.close();}
 });
 test(label+': anonymous, reviewer, delegated, cross-origin and generic-command writes cannot reach notices',async()=>{
  const env=await fixture();try{
   await commitControl(env.DB,{id:'principal',expectedRevision:0,type:'frontier.principal',data:{id:'agent:engineering',name:'Test delegate',credentialSha256:await controlHash('delegate')}},owner,Math.floor(Date.now()/1000));
   await commitControl(env.DB,{id:'delegate-grant',expectedRevision:1,type:'delegate',data:{id:'delegate',parent:'root',subject:'agent:engineering',scopes:['record.write','request.create'],resourcePrefix:'*',expiresAt:Math.floor(Date.now()/1000)+3600}},owner,Math.floor(Date.now()/1000));
   const body=create(2);assert.equal((await worker.fetch(request(path,body),env)).status,200);
   for(const auth of [null,'delegate','invalid'])for(const route of [path,'/api/control/v2/receipts/ops-create']){const r=await worker.fetch(request(route,undefined,auth),env);assert.ok([401,403].includes(r.status));assert.ok(!(await r.text()).includes(sentinel));}
   assert.equal((await worker.fetch(request(path,create(3),'delegate'),env)).status,403);
   assert.equal((await worker.fetch(request(path,create(3),null,{'oai-authenticated-user-id':'reviewer','oai-authenticated-user-email':'reviewer@example.test',Origin:'https://numina.test'}),env)).status,403);
   assert.equal((await worker.fetch(request(path,create(3),token,{Origin:'https://evil.test'}),env)).status,403);
   assert.equal((await worker.fetch(request(path+'?private=1'),env)).status,400);
   const direct={...create(3),id:'generic',type:'frontier.operations_notice'};assert.equal((await worker.fetch(request('/api/control/v1/commands',direct),env)).status,409);
   const nonOwner=await worker.fetch(request('/api/control/v2/state',undefined,'delegate'),env);assert.equal(nonOwner.status,200);const scoped=await nonOwner.json();assert.equal(scoped.content.operationsInbox,undefined);assert.ok(!JSON.stringify(scoped).includes(sentinel));
   const v1=await controlManifestView(env.DB,'agent:engineering',Math.floor(Date.now()/1000));assert.ok(!JSON.stringify(v1).includes(sentinel));assert.equal(v1.content.frontier,undefined);
   assert.equal((await readControl(env.DB)).revision,3);
  }finally{env.DB.close();}
 });
 test(label+': signing and journal integrity failures prevent all notice writes',async()=>{
  const env=await fixture();try{
   const saved=env.NUMINA_RECEIPT_PRIVATE_JWK;delete env.NUMINA_RECEIPT_PRIVATE_JWK;assert.equal((await worker.fetch(request(path,create()),env)).status,503);assert.equal((await readControl(env.DB)).revision,0);
   env.NUMINA_RECEIPT_PRIVATE_JWK=saved;await env.DB.prepare('UPDATE numina_control_manifest SET manifest_hash=? WHERE id=1').bind('corrupt').run();assert.equal((await worker.fetch(request(path,create()),env)).status,503);
  }finally{env.DB.close();}
 });
 test(label+': private notice sentinel is absent across every registered public surface and discovery',async()=>{
  const env=await fixture();try{
   assert.equal((await worker.fetch(request(path,create()),env)).status,200);assert.equal(Object.keys(CONNECTION_TARGETS).length,21);
   for(const [surfaceId,target] of Object.entries(CONNECTION_TARGETS)){
    const body=target.kind==='mcp'?{jsonrpc:'2.0',id:'probe',method:'tools/list'}:undefined;
    const response=await worker.fetch(request(target.path,body,null),env);const expected=surfaceId==='application-api'?503:surfaceId==='integration-kit'&&label==='source'?404:['mcp-operations','treasury','provider-observations','provider-routes','integration-kit'].includes(surfaceId)?401:200;assert.equal(response.status,expected,target.path);assert.ok(!(await response.text()).includes(sentinel),target.path);
   }
   for(const route of ['/api/control/v2/tree','/api/control/v2/state','/api/control/v1/state','/api/control/v2/head'])assert.ok(!(await (await worker.fetch(request(route,undefined,null),env)).text()).includes(sentinel),route);
  }finally{env.DB.close();}
 });
}
