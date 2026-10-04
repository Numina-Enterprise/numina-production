import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {COUNTRY_CODES} from '../public/country-codes.js';
import {NUMINA_LEGAL_DISCOVERY} from '../public/legal-discovery.js';
import {countryOptions} from '../public/app-entry.js';
import {appIntake,APP_CONSENT_VERSION,APP_OFFERS} from '../src/app-core.js';
import worker from '../src/worker.js';
import {database} from '../scripts/sqlite.mjs';
import {verifyMaintainedHostedLegalOverlay} from '../scripts/production-pair.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const read=p=>readFileSync(resolve(root,p),'utf8');
const built=(await import('../dist/server/index.js')).default;
const files=['compliance.html','compliance-coverage.json','country-readiness.json','iowa-entity-registry.json','charitable-relationship.json','compliance-ui.js','compliance-model.js','compliance.css','legal-discovery.js','country-codes.js'];
const intake={idempotencyKey:'a'.repeat(8)+'-aaaa-aaaa-aaaa-'+'a'.repeat(12),service:'diagnostic_enterprise',title:'Review operations',brief:'Review this authorized operational workflow.',successCriteria:'A scoped and evidence-backed plan.',consent:true,consentVersion:APP_CONSENT_VERSION};
const routes=[['/api/app/v1/legal-manifest','compliance-coverage.json'],['/api/app/v1/country-readiness','country-readiness.json']];
function environment(changes={}){
 return {NUMINA_TELEMETRY_LOGS:'false',get DB(){throw Error('Public legal evidence must not read private state');},ASSETS:{fetch:async req=>{
  assert.equal(req.headers.has('Cookie'),false);assert.equal(req.headers.has('Authorization'),false);
  const file=new URL(req.url).pathname.slice(1);
  if(Object.hasOwn(changes,file))return changes[file];
  return new Response(req.method==='HEAD'?null:read('dist/client/'+file));
 }}};
}
test('UI, intake and coverage use one exact country inventory without granting activation',()=>{
 assert.equal(COUNTRY_CODES.length,249);assert.equal(new Set(COUNTRY_CODES).size,249);
 assert.deepEqual(countryOptions().map(([code])=>code).sort(),[...COUNTRY_CODES].sort());
 const countries=JSON.parse(read('public/country-readiness.json')).countries;
 assert.deepEqual(countries.map(row=>row.code).sort(),[...COUNTRY_CODES].sort());
 for(const country of COUNTRY_CODES)assert.equal(appIntake({...intake,country}).country,country);
 for(const country of ['ZZ','UK','EU','us','USA','',null,'__proto__'])assert.throws(()=>appIntake({...intake,country}),/INVALID_INPUT/);
 for(const row of countries){assert.equal(row.financial_activation,false);assert.equal(row.enterprise_activation,false);assert.deepEqual(row.approved_activity_scopes,[]);}
});
test('Iowa entity observation stays source-bound without granting signer or market authority',()=>{
 const raw=read('public/iowa-entity-registry.json'),registry=JSON.parse(raw),coverage=JSON.parse(read('public/compliance-coverage.json'));
 assert.equal(registry.schema,'numina.iowa-entity-registry-readback.v1');assert.equal(registry.businessNumber,'724721');assert.equal(registry.status,'Active');
 assert.equal(registry.personalOrStreetAddressesIncluded,false);assert.equal(registry.filingsOrAccountChangesPerformed,false);
 const receipt=coverage.operator.verified_registry_receipt;assert.equal(receipt.url,'/iowa-entity-registry.json');
 for(const flag of ['owner_control_verified','human_signer_authority_verified','certified_good_standing','trade_name_approval_verified','foreign_permission_verified'])assert.equal(receipt[flag],false,flag);
 const evidence=coverage.evidence.find(item=>item.id==='iowa-registry');assert.ok(evidence);
 assert.equal(evidence.source_file,'public/iowa-entity-registry.json');assert.equal(evidence.snapshot_sha256,createHash('sha256').update(raw).digest('hex'));
 assert.equal(read('dist/client/iowa-entity-registry.json'),raw);
});
test('current public coverage is served unchanged by both source and built GET/HEAD APIs without private state',async()=>{
 for(const handler of [worker,built])for(const [route,file]of routes)for(const method of ['GET','HEAD']){
  const response=await handler.fetch(new Request('https://numinalabs.xyz'+route,{method,headers:{Cookie:'private',Authorization:'Bearer private'}}),environment());
  assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.equal(response.headers.get('X-Numina-Legal-Revision'),NUMINA_LEGAL_DISCOVERY.recordRevision);
  assert.equal(response.headers.get('Strict-Transport-Security'),'max-age=31536000');
  assert.equal(await response.text(),method==='HEAD'?'':read('public/'+file));
 }
});
test('public coverage rejects writes, supplied destinations, absent or changed approval evidence',async()=>{
 for(const handler of [worker,built])for(const [route,file]of routes){
  for(const method of ['POST','PUT','DELETE'])assert.equal((await handler.fetch(new Request('https://numinalabs.xyz'+route,{method}),environment())).status,405);
  assert.equal((await handler.fetch(new Request('https://numinalabs.xyz'+route+'?url=https://other.test'),environment())).status,400);
  const original=JSON.parse(read('public/'+file));
  const mutations=[value=>value.identity='OTHER',value=>value.application_version='3.0.0',value=>value.record_revision='old'];
  if(file==='country-readiness.json')mutations.push(value=>value.countries.pop(),value=>value.countries[0].code='ZZ',value=>value.countries[0]=value.countries[1],value=>value.countries[0].financial_activation=true,value=>value.countries[0].enterprise_activation=true);
  else mutations.push(value=>value.summary.global_certification=true,value=>value.summary.approved_country_count=249,value=>value.summary.regulated_financial_activation=true);
  for(const mutate of mutations){const value=structuredClone(original);mutate(value);for(const method of ['GET','HEAD']){
   const response=await handler.fetch(new Request('https://numinalabs.xyz'+route,{method}),environment({[file]:Response.json(value)}));assert.equal(response.status,503);if(method==='HEAD')assert.equal(await response.text(),'');
  }}
  for(const response of [new Response(null,{status:404}),new Response('{')])assert.equal((await handler.fetch(new Request('https://numinalabs.xyz'+route),environment({[file]:response}))).status,503);
 }
});
test('every maintained website footer and built legal asset exposes the shared coverage',async()=>{
 for(const file of files)assert.equal(read('dist/client/'+file),read('public/'+file),file);
 for(const file of readdirSync(resolve(root,'public')).filter(name=>name.endsWith('.html'))){
  const source=read('public/'+file);
  assert.match(source,/href="\/compliance"/,file);assert.match(source,/href="\/terms"/,file);assert.match(source,/href="\/software-licenses"/,file);
  if(file==='pricing.html'){assert.equal(existsSync(resolve(root,'dist/client/pricing.html')),false,'Legacy pricing asset cannot bypass /services redirect');continue;}
  assert.equal(read('dist/client/'+file),source,file);
 }
 for(const handler of [worker,built])for(const route of ['/compliance','/compliance/']){
  const response=await handler.fetch(new Request('https://numinalabs.xyz'+route),environment());assert.equal(response.status,200);assert.equal(await response.text(),read('public/compliance.html'));
 }
});
test('existing installed MCP discovery tools and public manifests return matching legal revision and scope',async()=>{
 const registry=JSON.parse(read('public/security-surfaces.json'));
 for(const handler of [worker,built]){
  const env={NUMINA_TELEMETRY_LOGS:'false',ASSETS:{fetch:async()=>Response.json(registry)},DB:{prepare(sql){assert.match(sql,/numina_limits_v1/);return {bind(){return this;},async first(){return {count:1};}};},async batch(){return [{results:[]},{results:[{count:1}]}];}}};
  for(const name of ['numina_connections','numina_capabilities']){
   const response=await handler.fetch(new Request('https://numina.test/api/control/v2/discovery-mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:{}}})}),env);
   assert.equal(response.status,200);const rpc=await response.json();assert.equal(rpc.result.isError,false);assert.deepEqual(JSON.parse(rpc.result.content[0].text).legal,NUMINA_LEGAL_DISCOVERY);
  }
  const response=await handler.fetch(new Request('https://numina.test/api/control/v2/manifest'),env);assert.deepEqual((await response.json()).legal,NUMINA_LEGAL_DISCOVERY);
 }
 assert.equal(NUMINA_LEGAL_DISCOVERY.financialActivation,false);assert.equal(NUMINA_LEGAL_DISCOVERY.globalLegalApproval,false);
 assert.match(NUMINA_LEGAL_DISCOVERY.scope,/not_operating_authorization/);
 assert.equal(read('integrations/numina/src/legal-discovery.js'),read('public/legal-discovery.js'));
});
test('delivered integration, plugin and mobile source archives contain exact shared companions and current native links',()=>{
 const python=process.env.NUMINA_PYTHON||'python3';
 const result=spawnSync(python,['-c',String.raw`
import hashlib,json,pathlib,zipfile
root=pathlib.Path('.')
archives=[('numina-integration-kit-v4.0.0.zip','integrations/numina'),('numina-codex-plugin-4.0.0.zip','integrations/codex/numina'),('numina-os-4.0.0-android-source.zip','mobile/android'),('numina-os-4.0.0-ios-source.zip','mobile/ios')]
expected_snapshots={'legal-policy.json','compliance-coverage.json','country-readiness.json','iowa-entity-registry.json','charitable-relationship.json','software-licenses.json','THIRD-PARTY-NOTICES.txt','terms.html','privacy.html','software-licenses.html','LICENSE.md','NOTICE.md'}
verified=0
for archive,source in archives:
 with zipfile.ZipFile(root/'docs'/archive) as z:
  assert z.testzip() is None
  paths=[p for p in z.namelist() if p.endswith('/legal/manifest.json')]
  assert len(paths)==1
  prefix=paths[0][:-len('legal/manifest.json')]
  manifest=json.loads(z.read(paths[0]))
  assert manifest['recordRevision']=='numina-global-2026-10-04' and manifest['legalApproval'] is False
  assert z.read(paths[0])==(root/source/'legal/manifest.json').read_bytes()
  assert len(manifest['snapshots'])==len(expected_snapshots)
  assert {row['path'] for row in manifest['snapshots']}==expected_snapshots
  for row in manifest['snapshots']:
   data=z.read(prefix+'legal/'+row['path'])
   assert hashlib.sha256(data).hexdigest()==row['sha256']
   assert data==(root/'public'/row['path']).read_bytes()
   verified+=1
  if source=='mobile/android':
   for file in ['app/src/main/AndroidManifest.xml','app/src/main/java/xyz/numinalabs/app/NuminaLauncherActivity.java','app/src/main/res/xml/legal_shortcuts.xml']:
    assert z.read(prefix+file)==(root/source/file).read_bytes()
  if source=='mobile/ios':
   for file in ['Numina/AppConfiguration.swift','Numina/ContentView.swift','Numina/HostedAppModel.swift','RELEASE-INPUTS.md']:
    assert z.read(prefix+file)==(root/source/file).read_bytes()
print(json.dumps({'archives':len(archives),'exactCompanionSnapshots':verified,'nativeLinkSourceMatches':True,'nativeCompilationEstablished':False}))
`],{cwd:root,encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).exactCompanionSnapshots,48);
 for(const file of ['verification.json','distribution.json','file-manifest.json']){
  const metadata=JSON.parse(read('integrations/numina/'+file));assert.equal(metadata.legal.recordRevision,NUMINA_LEGAL_DISCOVERY.recordRevision);assert.equal(metadata.legal.legalApproval,false);assert.equal(metadata.legal.charitableRelationship,NUMINA_LEGAL_DISCOVERY.charitableRelationship);
 }
 const plugin=JSON.parse(read('integrations/codex/numina/.codex-plugin/plugin.json'));assert.match(plugin.interface.longDescription,/https:\/\/numinalabs\.xyz\/compliance/);
 const android=read('mobile/android/app/src/main/AndroidManifest.xml');assert.equal((android.match(/<uses-permission /g)||[]).length,1);assert.doesNotMatch(android,/ADDITIONAL_TRUSTED_ORIGINS|personal-space/);
});
test('native iOS URL policy executes strict legal and browser-origin boundaries in Foundation',t=>{
 const probe=spawnSync('swift',['--version'],{encoding:'utf8'});
 if(probe.status!==0){t.skip('Swift/Foundation unavailable on this host');return;} // Native URL-policy compilation is an additional host check.
 const directory=mkdtempSync(resolve(tmpdir(),'numina-legal-swift-'));
 try{
  const source=read('mobile/ios/Numina/AppConfiguration.swift')+String.raw`
let hosted = "https://personal-space-m7q9.skott34.chatgpt.site"
for path in ["/terms", "/privacy", "/software-licenses", "/compliance"] {
 let url=URL(string:"https://numinalabs.xyz"+path+"?private=1#private")!
 precondition(AppConfiguration.isFirstParty(url));precondition(AppConfiguration.diagnosticRoute(url)==path)
}
precondition(AppConfiguration.isBrowserSignIn(URL(string:hosted+"/signin-with-chatgpt?return_to=%2Fapp")!))
precondition(!AppConfiguration.isFirstParty(AppConfiguration.browserWorkspaceURL))
for value in ["http://personal-space-m7q9.skott34.chatgpt.site/signin-with-chatgpt",hosted+":444/signin-with-chatgpt","https://user@personal-space-m7q9.skott34.chatgpt.site/signin-with-chatgpt","https://personal-space-m7q9.skott34.chatgpt.site.attacker.test/signin-with-chatgpt","https://other.chatgpt.site/signin-with-chatgpt",hosted+"/app"] {
 precondition(!AppConfiguration.isBrowserSignIn(URL(string:value)!))
}
print("Strict source URL-policy checks passed; no iOS app binary or device outcome asserted")
`;
  const path=resolve(directory,'policy.swift');writeFileSync(path,source);const result=spawnSync('swift',[path],{encoding:'utf8',timeout:60000});assert.equal(result.status,0,result.stderr);
 }finally{rmSync(directory,{recursive:true,force:true});}
});


test('final hosted source binding allows only public legal discovery and rejects changed authorization or methods',()=>{
 const source={path:'src/sites-mcp.js',sha256:'abda6b22471aa17feb00c0d98b385f6a211cff3ee859e9a59fef79a4eeb5839d'};
 assert.equal(verifyMaintainedHostedLegalOverlay(source).authorizationBytesPreserved,true);
 const maintained=read(source.path);
 for(const change of [maintained.replace("req.method!=='POST'","req.method!=='GET'"),maintained.replace('if(response.status!==200)return response;','if(false)return response;'),maintained.replace("if(!Object.hasOwn(msg,'id'))return response;","if(false)return response;")])assert.throws(()=>verifyMaintainedHostedLegalOverlay(source,{maintainedSource:change}),/Only public legal discovery/);
 assert.throws(()=>verifyMaintainedHostedLegalOverlay({...source,sha256:'0'.repeat(64)}));
 assert.throws(()=>verifyMaintainedHostedLegalOverlay({...source,path:'.openai/hosting.json'}));
});


test('built workspace persists scoped foreign intake but cannot issue a checkout URL from client approval claims',async()=>{
 const db=database();
 try{
  for(const name of ['0001_useful_black_crow.sql','0002_chief_rachel_grey.sql'])for(const statement of read('drizzle/'+name).split('--> statement-breakpoint').map(value=>value.trim()).filter(Boolean))await db.prepare(statement).run();
  const env={DB:db,NUMINA_CONTROL_OWNER:'email:owner@example.test',NUMINA_STRIPE_WEBHOOK_SECRET:'whsec_local_fixture_only',NUMINA_STRIPE_TREASURY_ACCOUNT:'acct_localfixtureonly',NUMINA_TELEMETRY_LOGS:'false'};
  const call=(path,body)=>built.fetch(new Request('https://numina.test/api/app/v1/'+path,{method:'POST',headers:{Origin:'https://numina.test','Content-Type':'application/json','oai-authenticated-user-id':'customer','oai-authenticated-user-email':'customer@example.test'},body:JSON.stringify(body)}),env);
  const invalid=await call('orders',{...intake,idempotencyKey:crypto.randomUUID(),country:'ZZ'});assert.equal(invalid.status,400);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM numina_service_orders').first()).n,0);
  const created=await call('orders',{...intake,idempotencyKey:crypto.randomUUID(),country:'FR'});assert.equal(created.status,201);const {order}=await created.json();
  await db.prepare('UPDATE numina_service_orders SET status=? WHERE id=?').bind('scoped',order.id).run();
  const denied=await call('orders/'+order.id+'/checkout',{country:'US',countryReviewApproved:true,approved_activity_scopes:['consulting_checkout']});assert.equal(denied.status,409);const denial=await denied.json();assert.equal(denial.error,'COUNTRY_REVIEW_REQUIRED');assert.equal(denial.url,undefined);
  await db.prepare('UPDATE numina_service_orders SET country=? WHERE id=?').bind('ZZ',order.id).run();assert.equal((await call('orders/'+order.id+'/checkout',{})).status,409);
  await db.prepare('UPDATE numina_service_orders SET country=? WHERE id=?').bind('US',order.id).run();const accepted=await call('orders/'+order.id+'/checkout',{country:'FR'});assert.equal(accepted.status,200);assert.equal(new URL((await accepted.json()).url).origin,'https://book.stripe.com');
 }finally{db.close();}
});


test('charitable giving uses the exact Foundation route and cannot enter commercial intake',()=>{
 const record=JSON.parse(read('public/charitable-relationship.json'));
 assert.equal(record.schema,'numina.charitable-relationship.v1');assert.equal(record.identity,'NUMINA');assert.equal(record.application_version,'4.0.0');
 assert.equal(record.policy_revision,APP_CONSENT_VERSION);assert.equal(record.coverage_revision,NUMINA_LEGAL_DISCOVERY.recordRevision);
 assert.equal(record.giving.official_foundation_give_now_url,'https://cffrv.fcsuite.com/erp/donate/create/fund?funit_id=6517');
 assert.equal(record.giving.numina_commercial_checkout_accepts_charitable_gifts,false);assert.equal(record.giving.commercial_services_separate,true);
 assert.equal(record.giving.automatic_venture_revenue_pledge_or_percentage,false);assert.deepEqual(record.owner_designated_verticals.map(({name,role})=>({name,role})),[{name:'Numina Ventures',role:'Investment and incubation'},{name:'Numina Foundation',role:'Charity'}]);for(const row of record.owner_designated_verticals)assert.equal(row.classification,'OWNER_DESIGNATED_OPERATING_VERTICAL');
 for(const [key,value] of Object.entries(record.scope_limits))assert.equal(value,false,key);
 assert.equal(NUMINA_LEGAL_DISCOVERY.charitableRelationship,'https://numinalabs.xyz/charitable-relationship.json');
 for(const file of ['about.html','compliance.html']){
  const html=read('public/'+file);assert.ok(html.includes(record.charitable_component.owner_preferred_display_name));
  assert.ok(html.includes('href="'+record.giving.official_foundation_give_now_url+'" target="_blank" rel="noopener noreferrer"'));
  assert.match(html,/href="\/charitable-relationship\.json"/);assert.match(html,/Foundation controls fund assets and distribution decisions/);
  assert.match(html,/commercial services and payments remain separate/);assert.match(html,/Numina Ventures is Numina’s investment and incubation vertical/);assert.match(html,/Numina Foundation is Numina’s charitable vertical/);assert.match(html,/do not establish investment permissions, a separate charitable incorporation, or tax-exempt status/);
 }
 assert.ok(read('public/about.html').includes(record.charitable_component.formal_foundation_profile_name.replace('&','&amp;')));
 assert.ok(read('public/about.html').includes(record.giving.official_profile_url));
 const paid=Object.entries(APP_OFFERS).filter(([,offer])=>!offer.retired&&!offer.requestOnly);
 assert.deepEqual(paid.map(([key])=>key).sort(),['audit_enterprise','diagnostic_enterprise']);
 for(const [,offer]of paid){assert.equal(offer.currency,'usd');assert.equal(new URL(offer.url).origin,'https://book.stripe.com');}
 for(const service of ['donation','charity','charitable_gift'])assert.throws(()=>appIntake({...intake,country:'US',service}),/INVALID_INPUT/);
 assert.equal(read('dist/client/charitable-relationship.json'),read('public/charitable-relationship.json'));
});
