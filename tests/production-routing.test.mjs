import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {checkConnection} from '../public/connection-model.js';
import {NUMINA_TREASURY_CONNECTION as treasuryModel} from '../public/treasury-connection-model.js';
import worker from '../src/worker.js';
import {APP_CONSENT_VERSION,APP_LEGAL_POLICY} from '../src/app-core.js';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const config=JSON.parse(read('vercel.json'));
const backend='https://personal-space-m7q9.skott34.chatgpt.site';
test('API families retain the existing backend without public-origin recursion',()=>{
 for(const prefix of ['/api/app/v1','/api/control/v1','/api/control/v2','/api/ops/v1','/api/financial/v1','/api/reviewer/v1','/api/connections/v1','/api/nusd/v1']){
  const route=config.rewrites.find(r=>r.source===prefix+'/:path*');
  assert.equal(route?.destination,backend+prefix+'/:path*');
 }
 for(const route of [...config.rewrites,...config.redirects])assert.ok(!/^https:\/\/(www\.)?numinalabs\.xyz(?:\/|$)/.test(route.destination));
 for(const version of [2,3,4])assert.equal(config.rewrites.find(r=>r.source===`/v${version}/release/manifest`).destination,'/api/application-release');
 assert.equal(config.rewrites.find(r=>r.source==='/.well-known/agent-card.json').destination,backend+'/.well-known/agent-card.json');
});
test('static delivery enforces worker browser protections and keeps uploaded documents sandboxed',async()=>{
 const global=Object.fromEntries(config.headers.find(r=>r.source==='/(.*)').headers.map(h=>[h.key,h.value]));
 const response=await worker.fetch(new Request('https://numina.test/'),{NUMINA_TELEMETRY_LOGS:'false',ASSETS:{fetch:async()=>new Response('<!doctype html><title>Numina</title>',{headers:{'Content-Type':'text/html'}})}});
 for(const name of ['X-Content-Type-Options','X-Frame-Options','Referrer-Policy','Permissions-Policy','Strict-Transport-Security','Content-Security-Policy'])assert.equal(global[name],response.headers.get(name),name);
 assert.doesNotMatch(global['Content-Security-Policy'],/unsafe-inline|unsafe-eval/);
 assert.match(global['Content-Security-Policy'],/frame-ancestors 'none'/);
 assert.match(global['Content-Security-Policy'],/object-src 'none'/);
 const upload=Object.fromEntries(config.headers.find(r=>r.source==='/api/control/v1/treasury-documents/:path*').headers.map(h=>[h.key,h.value]));
 assert.equal(upload['Content-Security-Policy'],"sandbox; default-src 'none'");
});
test('the deployed workspace uses maintained sign-in and session logic instead of an archived contact fallback',()=>{
 for(const file of ['app-entry.js','app-ui.js','workspace-session.js','control.js','control-receipts.js','frontier-ui.js'])assert.equal(read('dist/client/'+file),read('public/'+file),file);
 assert.match(read('dist/client/workspace-session.js'),/\/signin-with-chatgpt\?return_to=/);
 assert.match(read('dist/client/app-ui.js'),/session=await api\('session'\)/);
});
test('built worker applies HSTS and framing controls to GET and HEAD static responses on every delivery origin',async()=>{
 const built=(await import('../dist/server/index.js')).default;
 for(const origin of ['https://numinalabs.xyz','https://personal-space-m7q9.skott34.chatgpt.site'])for(const method of ['GET','HEAD'])for(const path of ['/','/security']){
  const response=await built.fetch(new Request(origin+path,{method}),{NUMINA_TELEMETRY_LOGS:'false',ASSETS:{fetch:async()=>new Response(method==='HEAD'?null:'<!doctype html><title>Numina</title>',{headers:{'Content-Type':'text/html'}})}});
  assert.equal(response.status,200);assert.equal(response.headers.get('Strict-Transport-Security'),'max-age=31536000');assert.equal(response.headers.get('X-Frame-Options'),'DENY');assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
 }
});
test('maintained legal pages and policy are delivered by the built release and match workspace acceptance',async()=>{
 const built=(await import('../dist/server/index.js')).default;
 const policy=JSON.parse(read('public/legal-policy.json'));
 assert.equal(policy.consent_revision,APP_CONSENT_VERSION);assert.equal(policy.policy_revision,APP_CONSENT_VERSION);
 assert.equal(policy.terms_url,APP_LEGAL_POLICY.terms);assert.equal(policy.privacy_url,APP_LEGAL_POLICY.privacy);
 for(const file of ['terms.html','privacy.html','software-licenses.html','software-licenses.json','THIRD-PARTY-NOTICES.txt','legal-policy.json'])assert.equal(read('dist/client/'+file),read('public/'+file),file);
 const assets={fetch:async request=>{const name=new URL(request.url).pathname.slice(1);return new Response(read('dist/client/'+name),{headers:{'Content-Type':'text/html'}});}};
 for(const [route,file]of [['/terms','terms.html'],['/privacy','privacy.html'],['/software-licenses','software-licenses.html']])for(const handler of [worker,built]){
  const response=await handler.fetch(new Request('https://numinalabs.xyz'+route),{NUMINA_TELEMETRY_LOGS:'false',ASSETS:assets});
  assert.equal(response.status,200);assert.equal(await response.text(),read('public/'+file));assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
 }
 const catalog=await built.fetch(new Request('https://numinalabs.xyz/api/app/v1/catalog'),{NUMINA_TELEMETRY_LOGS:'false'});
 assert.equal(catalog.status,200);assert.deepEqual((await catalog.json()).legalPolicy,APP_LEGAL_POLICY);
});
test('connection checks accept current and historical product spelling, rejecting other products',async()=>{
 for(const product of ['NUMINA','Numina','Unrelated']){
  const result=await checkConnection('release-evidence',{origin:'https://numina.test',fetchImpl:async()=>Response.json({schema:'numina.application-release.v2',product,build_id:'a'.repeat(64)})});
  assert.equal(result.state,product==='Unrelated'?'error':'available');
 }
});
test('website evidence and maintained source versions agree without inventing mobile publication',()=>{
 const release=JSON.parse(read('public/final-build.json'));
 assert.deepEqual(release,JSON.parse(read('docs/NUMINA-FINAL-BUILD.json')));
 assert.equal(release.applicationVersion,JSON.parse(read('package.json')).version);
 assert.equal(release.applicationVersion,JSON.parse(read('integrations/numina/package.json')).version);
 assert.equal(Number(read('mobile/android/app/build.gradle').match(/versionCode (\d+)/)[1]),release.mobile.android.versionCode);
 assert.ok(read('mobile/ios/Configuration/Numina.xcconfig').includes('CURRENT_PROJECT_VERSION = '+release.mobile.ios.buildNumber));
 assert.equal(release.delivery.website.sourceAligned,true);
 assert.equal(release.delivery.website.observedDeployment.status,'READY');
 assert.equal(release.treasury.aggregateModeledValue,treasuryModel.aggregateModeledValue);
 assert.equal(release.treasury.modeledAllocationsAdditive,treasuryModel.modeledAllocationsAdditive);
 assert.equal(release.treasury.balanceCount,treasuryModel.balanceCount);
 assert.deepEqual(release.treasury.allocations,treasuryModel.allocations);
 assert.ok(release.treasury.allocations.every(component=>component.treasuryIdentity==='NUMINA'&&component.singular===true));
 assert.equal(release.treasury.externalBalancesAggregated,false);
 assert.equal(release.nusd.status,'JOURNAL_SNAPSHOT');
 assert.equal(release.nusd.mintedNusd,null);
 assert.equal(release.nusd.historicalChainMintEvidence.amountNusd,'1500000000000000');
 assert.equal(release.historicalNusdRelease.historicalRecord,true);
 assert.equal(release.delivery.website.observedDeployment.commit.length,40);
 assert.equal(release.storePublication.googlePlay,false);
 assert.equal(release.storePublication.appStore,false);
 assert.equal(release.delivery.applicationBackend.matchesNuminaSource,true);
 assert.equal(release.delivery.applicationBackend.identity,'NUMINA');
});
