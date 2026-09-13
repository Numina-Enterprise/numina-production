import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from '../scripts/sqlite.mjs';
import {bootstrapControl,readControl,commitControl} from '../src/control-store.js';
import {controlHash} from '../src/control.js';
import {TREASURY_DOCUMENT_LIMIT} from '../src/treasury-documents.js';
import {MemoryBucket} from './helpers/memory-bucket.mjs';
import worker from '../src/worker.js';
const base='https://numina.test/api/control/v1/treasury-documents',owner='email:owner@example.test',key='test-document-owner-key',pdf=new TextEncoder().encode('%PDF-1.4\nLOCAL TRANSPORT TEST - NOT BANK EVIDENCE\n%%EOF');
const identity=email=>({'oai-authenticated-user-id':'local-test','oai-authenticated-user-email':email});
const ownerHeaders=identity('owner@example.test'),delegateHeaders=identity('delegate@example.test');
async function fixture(){const DB=database();await bootstrapControl(DB,owner,Math.floor(Date.now()/1000));return {DB,BUCKET:new MemoryBucket(),NUMINA_CONTROL_OWNER:owner,NUMINA_CONTROL_API_KEY_SHA256:await controlHash(key)};}
function request(method='GET',body,headers={},suffix=''){return new Request(base+suffix,{method,headers:{...ownerHeaders,...(body?{'Content-Type':'application/pdf','X-Document-Name':'transport-test.pdf',Origin:'https://numina.test'}:{}),...headers},...(body?{body,duplex:'half'}:{})});}
async function call(env,req){const response=await worker.fetch(req,env);return {response,data:await response.json()};}

test('real bytes yield a private receipt and download without changing treasury verification or control state',async()=>{const env=await fixture();try{
 const before=await readControl(env.DB);const empty=await call(env,request());assert.equal(empty.data.documents.length,0);assert.equal(empty.data.receipt_scope,'file_storage_only');
 const {response,data}=await call(env,request('POST',pdf));assert.equal(response.status,201);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(data.document.classification,'owner_uploaded_unverified');assert.equal(data.document.bank_issuer_verified,false);assert.equal(data.document.size,pdf.length);assert.match(data.document.sha256,/^[a-f0-9]{64}$/);
 const listed=await call(env,request());assert.equal(listed.data.documents.length,1);assert.equal(listed.data.documents[0].id,data.document.id);
 const download=await worker.fetch(request('GET',undefined,{},'/'+data.document.id),env);assert.equal(download.status,200);assert.match(download.headers.get('Content-Disposition'),/^attachment;/);assert.equal(download.headers.get('Content-Type'),'application/octet-stream');assert.equal(download.headers.get('Content-Security-Policy'),"sandbox; default-src 'none'");assert.equal(download.headers.get('X-Content-Type-Options'),'nosniff');assert.deepEqual(new Uint8Array(await download.arrayBuffer()),pdf);
 const treasury=await(await worker.fetch(new Request('https://numina.test/api/control/v1/treasury',{headers:ownerHeaders}),env)).json();assert.equal(treasury.status,'NOT_INITIALIZED');assert.equal(treasury.projection,null);assert.equal(treasury.canonical_proof,null);
 const after=await readControl(env.DB);assert.equal(after.state_hash,before.state_hash);assert.equal(after.revision,before.revision);
}finally{env.DB.close();}});

test('owner isolation and exact write origin are enforced before reading files or touching the bucket',async()=>{const env=await fixture();try{
 for(const method of ['GET','POST'])for(const headers of [{},{Authorization:'Bearer invalid'},delegateHeaders]){const response=await worker.fetch(new Request(base,{method,headers,...(method==='POST'?{body:pdf}:{})}),env);assert.equal(response.status,headers['oai-authenticated-user-email']?403:401);assert.equal(response.headers.get('Cache-Control'),'private, no-store');}
 assert.equal((await worker.fetch(request('POST',pdf,{Origin:'https://evil.test'}),env)).status,403);assert.equal(env.BUCKET.calls,0);
 assert.equal((await worker.fetch(request('GET',undefined,delegateHeaders,'/'+'a'.repeat(64)),env)).status,403);assert.equal(env.BUCKET.calls,0);
 assert.equal((await worker.fetch(request('GET',undefined,{},'/../treasury-documents/invalid'),env)).status,404);
 assert.equal((await worker.fetch(request('POST',pdf,{Authorization:'Bearer '+key,Origin:'https://irrelevant.test'}),env)).status,201);
 assert.equal((await worker.fetch(request('GET'),{...env,NUMINA_CONTROL_OWNER:'email:changed@example.test'})).status,503);
}finally{env.DB.close();}});

test('empty, mismatched, oversized, compressed and malformed-name uploads never create receipts',async()=>{const env=await fixture();try{
 const cases=[[new Uint8Array(),{},400],[new TextEncoder().encode('<html>not a PDF</html>'),{},415],[pdf,{'Content-Type':'text/html'},415],[pdf,{'X-Document-Name':'../statement.pdf'},400],[pdf,{'X-Document-Name':'%0D%0Asecret.pdf'},400],[pdf,{'X-Document-Name':'%ZZ.pdf'},400],[pdf,{'X-Document-Name':'x'.repeat(170)+'.pdf'},400],[pdf,{'Content-Encoding':'gzip'},415],[pdf,{'Content-Length':String(TREASURY_DOCUMENT_LIMIT+1)},413],[pdf,{'Content-Length':'1'},400],[new Uint8Array(TREASURY_DOCUMENT_LIMIT+1),{},413]];
 for(const [body,headers,status] of cases){const res=await worker.fetch(request('POST',body,headers),env);assert.equal(res.status,status,JSON.stringify(headers));}
 assert.equal(env.BUCKET.objects.size,0);
}finally{env.DB.close();}});

test('identical retry and concurrent uploads preserve the first immutable receipt',async()=>{const env=await fixture();try{
 const results=await Promise.all([call(env,request('POST',pdf)),call(env,request('POST',pdf))]);assert.deepEqual(results.map(r=>r.response.status).sort(),[200,201]);assert.equal(results[0].data.document.id,results[1].data.document.id);assert.equal(env.BUCKET.objects.size,1);
 const renamed=await call(env,request('POST',pdf,{'X-Document-Name':'renamed.pdf'}));assert.equal(renamed.data.replayed,true);assert.equal(renamed.data.document.name,'transport-test.pdf');assert.equal(env.BUCKET.objects.size,1);
}finally{env.DB.close();}});

test('failed or uncertain storage never claims a receipt; retry discovers an already stored file',async()=>{const env=await fixture();try{
 assert.equal((await worker.fetch(request(),{...env,BUCKET:undefined})).status,503);
 env.BUCKET.failPut=true;let result=await call(env,request('POST',pdf));assert.equal(result.response.status,503);assert.equal(result.data.document,undefined);assert.equal(env.BUCKET.objects.size,0);
 env.BUCKET.failPut=false;env.BUCKET.failAfterPut=true;result=await call(env,request('POST',pdf));assert.equal(result.response.status,503);assert.equal(result.data.document,undefined);assert.equal(env.BUCKET.objects.size,1);
 result=await call(env,request('POST',pdf));assert.equal(result.response.status,200);assert.equal(result.data.replayed,true);
 env.BUCKET.failList=true;assert.equal((await worker.fetch(request(),env)).status,503);env.BUCKET.failList=false;
 const item=[...env.BUCKET.objects.values()][0];item.options.customMetadata.sha256='bad';assert.equal((await worker.fetch(request(),env)).status,503);assert.equal((await worker.fetch(request('GET',undefined,{},'/'+result.data.document.id),env)).status,503);
}finally{env.DB.close();}});

test('document receipts do not leak through public APIs or delegated internal records',async()=>{const env=await fixture();try{
 const uploaded=await call(env,request('POST',pdf,{'X-Document-Name':'private-document-7392.pdf'}));const now=Math.floor(Date.now()/1000);await commitControl(env.DB,{id:'doc-delegate',expectedRevision:0,type:'delegate',data:{id:'document-g',parent:'root',subject:'email:delegate@example.test',scopes:['request.create','record.write'],resourcePrefix:'record:',expiresAt:now+300}},owner,now);
 for(const path of ['/api/control/v1/health','/api/control/v1/manifest','/api/nusd/v1/status','/api/nusd/v1/redemption-policy','/api/control/v1/state']){const response=await worker.fetch(new Request('https://numina.test'+path,{headers:delegateHeaders}),env);const body=await response.text();assert.equal(response.status,200);assert.equal(body.includes('private-document-7392.pdf'),false);assert.equal(body.includes(uploaded.data.document.id),false);}
 const status=await(await worker.fetch(new Request('https://numina.test/api/nusd/v1/status'),env)).json();for(const capability of ['mint','exchange','redemption','settlement'])assert.equal(status.capabilities[capability],false);
}finally{env.DB.close();}});
