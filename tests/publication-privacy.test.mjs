import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import built from '../dist/server/index.js';
import {database} from '../scripts/sqlite.mjs';
import {bootstrapControl} from '../src/control-store.js';
import {privateArtifactPaths} from '../scripts/public-asset-privacy.mjs';
import * as model from '../public/treasury-connection-model.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const owner='email:privacy-owner@example.test',token='local-privacy-fixture';
async function fixture(t){const db=database();t.after(()=>db.close());await bootstrapControl(db,owner,Math.floor(Date.now()/1000));return {DB:db,NUMINA_CONTROL_OWNER:owner,NUMINA_CONTROL_API_KEY_SHA256:sha(token),NUMINA_TELEMETRY_LOGS:'false',ASSETS:{fetch(req){const file=new URL('../dist/client'+new URL(req.url).pathname,import.meta.url);return existsSync(file)?new Response(readFileSync(file)):new Response('',{status:404});}}};}
const request=(path,auth=false,method='GET')=>new Request('https://numina.test'+path,{method,headers:auth?{Authorization:'Bearer '+token}:{}});
const privatePaths=[...privateArtifactPaths.map(p=>'/'+p),'/api/control/v1/private-assets/treasury-proof.js','/api/control/v1/private-assets/treasury-preparation.js'];

test('restricted evidence and exact private verifier cannot bypass owner authentication through static delivery',async t=>{
 const env=await fixture(t);
 for(const path of privatePaths){
  assert.equal(existsSync(new URL('../dist/client'+path,import.meta.url)),false,path);
  for(const method of ['GET','HEAD']){const response=await built.fetch(request(path,false,method),env);assert.equal(response.status,401,path);assert.match(response.headers.get('Cache-Control'),/private.*no-store/);}
  const denied=await built.fetch(request(path,true),{...env,NUMINA_REVIEW_SESSION:true});assert.equal(denied.status,403,path);
  const response=await built.fetch(request(path,true),env);assert.equal(response.status,200,path);assert.equal(response.headers.get('CDN-Cache-Control'),'no-store');
 }
 const response=await built.fetch(request('/api/control/v1/private-assets/treasury-proof.js',true),env);assert.deepEqual(Buffer.from(await response.arrayBuffer()),read('public/treasury-proof.js'));
 for(const [route,file] of [['/final-build.json','public/final-build.json'],['/final-manifest.json','public/final-manifest.json'],['/downloads/numina-integration-kit-v4.0.0.zip','docs/numina-integration-kit-v4.0.0.zip']]){const response=await built.fetch(request(route,true),env);assert.equal(sha(Buffer.from(await response.arrayBuffer())),sha(read(file)));}
 assert.equal((await built.fetch(request('/api/control/v1/journal?after=0'),env)).status,401);
});

const confidential=[];
function collect(value,key=''){
 if(value&&typeof value==='object'){for(const [name,item]of Object.entries(value))collect(item,name);return;}
 if(typeof value==='string'&&(/(?:accountLast4|linkedAccountLast4|achRoutingNumber|routingReference|providerTransactionId|providerConfirmation|assertedConfirmation|transactionId|^confirmation$)/i.test(key)||/^(?:acct|fa|finaddr)_/.test(value)))confidential.push(value);
}
Object.values(model).forEach(value=>collect(value));
function assertPrivateAbsent(text,context){
 assert.doesNotMatch(text,/\b(?:acct|fa|finaddr)_[A-Za-z0-9]+\b/,context);
 for(const value of new Set(confidential.filter(value=>value.length>4)))assert.equal(text.includes(value),false,context+' confidential value');
 assert.doesNotMatch(text,/Savings\s+\d{4}\b/,context);
}
test('public files and public metadata APIs omit bank/provider account and transaction details',async t=>{
 const walk=dir=>readdirSync(dir).flatMap(name=>statSync(dir+'/'+name).isDirectory()?walk(dir+'/'+name):[dir+'/'+name]);
 for(const path of walk(new URL('../dist/client',import.meta.url).pathname).filter(path=>/\.(json|js|html|md|txt)$/.test(path)))assertPrivateAbsent(readFileSync(path,'utf8'),path);
 const env=await fixture(t);
 for(const path of ['/api/treasury/v1/model','/api/financial/v1/manifest','/api/control/v2/architecture','/api/control/v2/manifest']){const response=await built.fetch(request(path),env);assert.equal(response.status,200,path);assertPrivateAbsent(await response.text(),path);}
});

test('approved journal summary preserves read/event dates, unknown activation and scoped mint evidence',()=>{
 const summary=JSON.parse(read('dist/client/journal-summary.json'));
 assert.match(summary.observedAt,/^2026-10-04T/);assert.match(summary.latestEvent.eventAt,/^2026-09-21T00:57:06/);
 assert.equal(summary.observedState.revision,142);assert.equal(summary.observedState.settlementStatus,'UNVERIFIED');assert.equal(summary.observedState.singularSettlementReceiptId,null);
 assert.equal(summary.observedState.contractsActive,null);assert.equal(summary.observedState.paused,null);assert.equal(summary.mintRequest.status,'PREPARED');assert.equal(summary.mintRequest.network_reference,'eip155:962421430');assert.equal(summary.mintRequest.receipt,null);
 assert.equal(summary.liveFeed,false);assert.equal(summary.access.rawJournal,'authenticated');
 assert.equal(summary.ownerSettlementConfirmation.status,'VERIFIED');assert.equal(summary.ownerSettlementConfirmation.verificationSource,'OWNER_CONFIRMATION');assert.equal(summary.ownerSettlementConfirmation.settlementDate,'2026-08-31');
});

test('public preparation facade captures intent before loading, preserves drafts, and gates every invocation',async()=>{
 let gateResolve,allowed=true,calls=0,seen,draft={id:'private-draft'},submitted;
 const gate=new Promise(resolve=>gateResolve=resolve);
 const factory=()=>({async prepare(input){seen=input;return draft;},async submit(value){submitted=value;return {ok:true};}});
 const text=read('dist/client/treasury-preparation.js').toString().replace('export function','function').replace("import('/api/control/v1/private-assets/treasury-preparation.js')",'loadPrivate()');
 const context=vm.createContext({structuredClone,fetch:async()=>{calls++;await gate;return {ok:allowed,status:allowed?200:401};},loadPrivate:async()=>({createTreasuryPreparation:factory})});
 vm.runInContext(text+'\nglobalThis.create=createTreasuryPreparation;',context);
 const client=context.create(),input={amount:'10'},pending=client.prepare(input);input.amount='999';gateResolve();
 assert.equal(await pending,draft);assert.equal(seen.amount,'10');await client.submit(draft);assert.equal(submitted,draft);
 allowed=false;await assert.rejects(client.submit(draft),error=>error.status===401);assert.equal(calls,3);
});
