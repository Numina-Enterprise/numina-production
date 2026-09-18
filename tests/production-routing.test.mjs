import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {checkConnection} from '../public/connection-model.js';
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
test('connection checks accept current and historical product spelling, rejecting other products',async()=>{
 for(const product of ['NUMINA','Numina','Unrelated']){
  const result=await checkConnection('release-evidence',{origin:'https://numina.test',fetchImpl:async()=>Response.json({schema:'numina.application-release.v2',product,build_id:'a'.repeat(64)})});
  assert.equal(result.state,product==='Unrelated'?'error':'available');
 }
});
test('website evidence and maintained source versions agree without inventing mobile publication',()=>{
 const release=JSON.parse(read('public/final-build.json'));
 assert.deepEqual(release,JSON.parse(read('release-evidence/numina-final-build-2026-09-18.json')));
 assert.equal(release.applicationVersion,JSON.parse(read('package.json')).version);
 assert.equal(release.applicationVersion,JSON.parse(read('integrations/numina/package.json')).version);
 assert.equal(Number(read('mobile/android/app/build.gradle').match(/versionCode (\d+)/)[1]),release.mobile.android.versionCode);
 assert.ok(read('mobile/ios/Configuration/Numina.xcconfig').includes('CURRENT_PROJECT_VERSION = '+release.mobile.ios.buildNumber));
 assert.equal(release.delivery.website.blocker,'VERCEL_DEPLOYMENT_DAILY_QUOTA');
 assert.equal(release.delivery.website.productionTransportUpdated,false);
 assert.equal(release.treasury.aggregateModeledValue,'500000000000000');
 assert.equal(release.treasury.modeledRoleValuesAdditive,false);
 assert.equal(release.nusd.amountNusd,'1500000000000000');
 assert.equal(release.delivery.website.observedDeployment.commit.length,40);
 assert.equal(release.storePublication.googlePlay,false);
 assert.equal(release.storePublication.appStore,false);
 assert.equal(release.delivery.applicationBackend.matchesCanonicalSource,false);
});
