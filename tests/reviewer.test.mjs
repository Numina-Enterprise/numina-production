import {APP_CONSENT_VERSION} from '../src/app-core.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker from '../src/worker.js';
import {database} from '../scripts/sqlite.mjs';
import {appDigest} from '../src/app-core.js';
import {bootstrapControl,readControl} from '../src/control-store.js';
import {reviewerHttp,reviewerContext,REVIEW_USER,REVIEW_SUBJECT,REVIEW_EMAIL} from '../src/reviewer.js';
const origin='https://numina.test',password='fixture-only-review-password-not-used-in-production',now=1900000000;
function request(path,{cookie,body,method=body?'POST':'GET',headers={}}={}){return new Request(origin+path,{method,headers:{Origin:origin,...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});}
const intake=()=>({idempotencyKey:crypto.randomUUID(),service:'diagnostic_enterprise',title:'Reviewer access verification',brief:'A test request to verify the production customer workflow without buying a service.',successCriteria:'Create, read, reach checkout and cancel this account-owned request.',country:'US',consent:true,consentVersion:APP_CONSENT_VERSION});
async function fixture(t){
 const db=database();t.after(()=>db.close());
 for(const file of ['0001_useful_black_crow','0002_chief_rachel_grey','0003_google_play_reviewer']){
  const sql=readFileSync(new URL('../drizzle/'+file+'.sql',import.meta.url),'utf8').replace(/--[^\n]*/g,'');
  for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
 }
 await bootstrapControl(db,'email:production-owner@example.test',now);
 const env={DB:db,ASSETS:{fetch(){return new Response('Not found',{status:404});}},NUMINA_TELEMETRY_LOGS:'false',NUMINA_REVIEW_ENABLED:'true',NUMINA_REVIEW_RECORD_SCOPE:'own',NUMINA_REVIEW_PASSWORD_SHA256:await appDigest(password),NUMINA_REVIEW_SESSION_KEY:'a'.repeat(64),NUMINA_CONTROL_OWNER:'email:production-owner@example.test',NUMINA_CONTROL_API_KEY_SHA256:await appDigest('production-secret'),NUMINA_STRIPE_WEBHOOK_SECRET:'production-webhook-secret',NUMINA_STRIPE_TREASURY_READ_KEY:'production-read-secret'};
 const login=(at=now)=>reviewerHttp(request('/api/reviewer/v1/login',{body:{username:REVIEW_USER,password}}),env,at);
 return {db,env,login};
}
test('review sign-in creates no business records and returns a bounded secure production session',async t=>{
 const f=await fixture(t),result=await f.login();assert.equal(result.status,200,await result.clone().text());
 const cookie=result.headers.get('Set-Cookie');for(const flag of ['__Host-numina-review=','Path=/','Max-Age=28800','Secure','HttpOnly','SameSite=Strict'])assert.ok(cookie.includes(flag));
 const body=await result.text();assert.doesNotMatch(body,/password|production-secret|SessionKey/);assert.equal(JSON.parse(body).scope,'production-own-records');
 assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM numina_service_orders').first()).n,0);
 const production=await readControl(f.db);assert.equal(production.manifest.root,'email:production-owner@example.test');assert.equal(production.revision,0);
 const retry=await f.login();assert.equal(retry.status,200);
});
test('wrong, disabled, widened, forged, duplicate, expired and cross-origin sessions fail closed',async t=>{
 const f=await fixture(t),result=await f.login(),cookie=result.headers.get('set-cookie').split(';')[0];
 const req=request('/api/app/v1/session',{cookie,headers:{Authorization:'Bearer production-secret','oai-authenticated-user-id':'owner','oai-authenticated-user-email':'production-owner@example.test'}});
 const context=await reviewerContext(req,f.env,now);assert.equal(context.req.headers.get('authorization'),null);assert.equal(context.req.headers.get('oai-authenticated-user-id'),REVIEW_SUBJECT);assert.equal(context.req.headers.get('oai-authenticated-user-email'),REVIEW_EMAIL);
 // Existing server credentials remain server-side, behind the normal handlers.
 assert.equal(context.env.DB,f.db);assert.equal(context.env.NUMINA_STRIPE_WEBHOOK_SECRET,'production-webhook-secret');
 for(const altered of [cookie.slice(0,-1)+(cookie.endsWith('0')?'1':'0'),cookie+'; '+cookie,'__Host-numina-review=bad'])assert.equal((await reviewerContext(request('/api/app/v1/session',{cookie:altered}),f.env,now)).error.status,401);
 assert.equal((await reviewerContext(req,f.env,now+28801)).error.status,401);
 assert.equal((await reviewerContext(new Request('https://other.test/api/app/v1/session',{headers:{Cookie:cookie}}),f.env,now)).error.status,401);
 for(const overrides of [{NUMINA_REVIEW_ENABLED:'false'},{NUMINA_REVIEW_RECORD_SCOPE:'all'},{NUMINA_REVIEW_SESSION_KEY:'b'.repeat(64)}])assert.equal((await reviewerContext(req,{...f.env,...overrides},now)).error.status,401);
 assert.equal(await reviewerContext(request('/api/app/v1/session'),f.env,now),null);
 assert.equal((await reviewerHttp(request('/api/reviewer/v1/login',{body:{username:REVIEW_USER,password:'wrong'}}),f.env,now)).status,401);
 assert.equal((await reviewerHttp(request('/api/reviewer/v1/login',{body:{username:REVIEW_USER,password},headers:{Origin:'https://other.test'}}),f.env,now)).status,403);
});
test('login rate limits and request limits apply; logout clears the session',async t=>{
 const f=await fixture(t);
 assert.equal((await reviewerHttp(request('/api/reviewer/v1/login',{body:{username:REVIEW_USER,password,operator:true}}),f.env,now)).status,401);
 assert.equal((await reviewerHttp(request('/api/reviewer/v1/login',{body:{username:REVIEW_USER,password:'x'.repeat(3000)}}),f.env,now)).status,413);
 let last;for(let i=0;i<12;i++)last=await f.login();assert.equal(last.status,429);
 const logout=await reviewerHttp(request('/api/reviewer/v1/logout',{method:'POST'}),f.env,now);assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
});
test('reviewer creates own production request, gets real checkout and cannot read or change another customer record',async t=>{
 const f=await fixture(t),realNow=Math.floor(Date.now()/1000),login=await f.login(realNow),cookie=login.headers.get('set-cookie').split(';')[0];
 const otherHeaders={'oai-authenticated-user-id':'other-customer','oai-authenticated-user-email':'other@example.test'};
 const otherResponse=await worker.fetch(request('/api/app/v1/orders',{body:intake(),headers:otherHeaders}),f.env);assert.equal(otherResponse.status,201);const other=(await otherResponse.json()).order;
 const call=(path,body)=>worker.fetch(request('/api/app/v1/'+path,{cookie,body}),f.env);
 const session=await (await call('session')).json();assert.equal(session.reviewer,true);assert.equal(session.operator,false);
 const created=await call('orders',intake());assert.equal(created.status,201,await created.clone().text());const id=(await created.json()).order.id;
 const list=await (await call('orders?scope=team')).json();assert.deepEqual(list.orders.map(o=>o.id),[id]);assert.equal(list.scope,'mine');
 for(const suffix of ['', '/events'])assert.equal((await call('orders/'+other.id+suffix)).status,404);
 assert.equal((await call('orders/'+other.id+'/checkout',{})).status,404);
 assert.equal((await call('orders/'+other.id+'/actions',{action:'cancel',note:'Unauthorized cancellation attempt.',revision:0,idempotencyKey:crypto.randomUUID()})).status,404);
 const checkout=await (await call('orders/'+id+'/checkout',{})).json();assert.equal(new URL(checkout.url).origin,'https://book.stripe.com');assert.equal(new URL(checkout.url).searchParams.get('client_reference_id'),id);assert.equal(checkout.simulated,undefined);
 assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM numina_app_payments').first()).n,0);
 assert.equal((await call('orders/'+id+'/actions',{action:'scope',note:'Must not gain operator permission.',revision:0,idempotencyKey:crypto.randomUUID()})).status,403);
 const cancel=await call('orders/'+id+'/actions',{action:'cancel',note:'Reviewer verification finished without purchase.',revision:0,idempotencyKey:crypto.randomUUID()});assert.equal(cancel.status,200);
 assert.equal((await f.db.prepare('SELECT status FROM numina_service_orders WHERE id=?').bind(other.id).first()).status,'submitted');
 for(const path of ['/api/control/v1/stripe-treasury','/api/control/v1/treasury','/api/control/v2/treasury/accounts'])assert.equal((await worker.fetch(request(path,{cookie}),f.env)).status,403);
 assert.equal((await worker.fetch(request('/api/reviewer/v1/sample-payment',{cookie,body:{orderId:id}}),f.env)).status,404);
});
test('review session cannot inherit root access from other login headers and invalid cookies cannot fall back to an owner session',async t=>{
 const f=await fixture(t),login=await f.login(Math.floor(Date.now()/1000)),cookie=login.headers.get('set-cookie').split(';')[0];
 const headers={'oai-authenticated-user-id':'production-owner','oai-authenticated-user-email':'production-owner@example.test',Authorization:'Bearer production-secret'};
 const real=await worker.fetch(request('/api/app/v1/session',{headers}),f.env);assert.equal((await real.json()).operator,true);
 const review=await worker.fetch(request('/api/app/v1/session',{cookie,headers}),f.env);const body=await review.text();assert.equal(JSON.parse(body).operator,false);assert.doesNotMatch(body,/production-secret|production-webhook-secret|production-read-secret/);
 const invalid=await worker.fetch(request('/api/app/v1/session',{cookie:'__Host-numina-review=bad',headers}),f.env);assert.equal(invalid.status,401);
});
