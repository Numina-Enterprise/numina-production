import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {NuminaClient} from '../integrations/numina/src/client.js';
import {WALLET_EXECUTION_POLICY} from '../public/wallet-execution-policy.js';
import {NUMINA_OWNER_APPROVAL} from '../public/owner-approval.js';
import {walletExecutionAuthorized} from '../public/wallet-execution-policy.js';

const bytes=path=>readFileSync(new URL('../'+path,import.meta.url));
const json=path=>JSON.parse(bytes(path));
const digest=value=>createHash('sha256').update(value).digest('hex');
const releasePath='dist/client/downloads/application-release-v4.json';

test('one owner approval binds both runtime manifests without manufacturing financial evidence',()=>{
 const release=json(releasePath),approval=release.owner_approval;
 for(const [key,value] of Object.entries(NUMINA_OWNER_APPROVAL))assert.deepEqual(approval[key],value);
 assert.equal(approval.sha256,digest(bytes('public/owner-approval.js')));
 assert.equal(approval.approved,true);assert.equal(approval.cryptographicSignature,null);
 assert.equal(WALLET_EXECUTION_POLICY.ownerApproved,true);
 assert.equal(WALLET_EXECUTION_POLICY.ownerApprovalId,approval.id);
 assert.equal(WALLET_EXECUTION_POLICY.requestSha256,approval.requestSha256);
 assert.equal(WALLET_EXECUTION_POLICY.issuerPolicySha256,approval.issuerPolicySha256);
 assert.equal(walletExecutionAuthorized(),false);
 assert.equal(WALLET_EXECUTION_POLICY.issuerPolicySigned,false);
 assert.equal(WALLET_EXECUTION_POLICY.reviews.filter(r=>r.verified).length,0);
 const handoff=release.approval_handoff,packageRecord=json('docs/Numina-1500T-Approval-Handoff-Package-Record.json');
 assert.equal(handoff.sha256,digest(bytes('docs/Numina-1500T-Approval-Handoff.zip')));
 assert.equal(handoff.sha256,packageRecord.sha256);
 assert.equal(handoff.record_sha256,digest(bytes('docs/Numina-1500T-Approval-Handoff-Package-Record.json')));
 const config=json('vercel.json');assert.equal(config.git.deploymentEnabled,true);
 for(const source of ['/wallet-signing','/wallet-signing.html','/deployment-readiness'])assert.equal(config.redirects.find(r=>r.source===source)?.destination,'https://numinalabs.xyz'+source);
 assert.equal(config.rewrites.find(r=>r.source==='/api/control/v1/:path*')?.destination,'https://numinalabs.xyz/api/control/v1/:path*');
 for(const version of ['2','3','4'])assert.equal(config.rewrites.find(r=>r.source==='/v'+version+'/release/manifest')?.destination,'/api/application-release');
});

test('root release manifest binds the owner workflow, additive migration and actual blocked policy',()=>{
 const release=json(releasePath),binding=release.owner_wallet_execution;
 assert.equal(binding.schema,'numina.owner-wallet.release-binding.v1');assert.deepEqual(binding.policy,WALLET_EXECUTION_POLICY);assert.equal(binding.submission_enabled,false);
 assert.equal(binding.owner_endpoint,'/api/control/v1/nusd-deployment');assert.equal(binding.final_confirmation,'owner_wallet');
 for(const name of ['model','policy','receipt','ui'])assert.equal(binding.modules[name].sha256,digest(bytes('public/wallet-execution-'+name+'.js')));
 assert.equal(binding.receipt_verification.minimum_confirmations,12);assert.equal(binding.receipt_verification.scope,'provider_observation_consistency');
 assert.equal(binding.attempt_storage.migration_sha256,digest(bytes('drizzle/0004_wallet_deployment_intents.sql')));assert.equal(binding.attempt_storage.native_journal_modified,false);
 assert.equal(release.compatibility.data_migration_required,true);assert.deepEqual(release.compatibility.additive_migrations,['0004_wallet_deployment_intents']);
 assert.deepEqual(binding.evidence,{signature:null,transaction_hash:null,receipt:null,mint_verified:false,provider_deposit_verified:false,reserves_verified:false});
 for(const flag of Object.values(release.scope))assert.equal(flag,false);
});

test('application manifest aliases contain the same current release bytes',()=>{
  const current=bytes(releasePath),release=JSON.parse(current);
  for(const name of ['release.json','application-release-v2.json','application-release-v3.json']){
    assert.deepEqual(bytes('dist/client/downloads/'+name),current,name);
  }
  assert.equal(release.version,'4.0.0');
  assert.equal(release.release,'numina-v4.0.0');
  assert.equal(release.schema,'numina.application-release.v2');
  assert.equal(release.runtime_dependency.version,'1.9.0-rc26');
  for(const field of ['root','manifest','identity','authority','source','evidence','provider','core','worker','journal','runtime','artifact','authentication','delivery','readiness','treasury'])assert.equal(release[field],'NUMINA',field);
  assert.equal(release.provider_verification,true);
});

test('current native distribution retains its actual Android and iOS build identities',()=>{
  const native=json('docs/native-package-record-v4.json');
  const distribution=json(releasePath).distribution.native_candidates;
  assert.equal(native.applicationVersion,'4.0.0');
  assert.equal(native.android.binaryApplicationVersion,'4.0.0');
  assert.equal(native.android.binaryVersionCode,3);
  assert.equal(native.ios.binaryApplicationVersion,'4.0.0');
  assert.equal(native.ios.binaryVersionCode,5);
  assert.equal(native.ios.signed,false);
  for(const platform of ['android','ios']){
    assert.deepEqual(distribution[platform],native[platform],platform);
    assert.equal(native[platform].sourceCommit,platform==='ios'?'c6ffbb50d77ff53323b71b7048872637677e6b42':'cd28af207f39fe8ba010ef83eafbd832448ffbbf');
    if(platform==='ios'){assert.equal(native[platform].currentSourceCompiled,true);assert.equal(native[platform].signingInputMatchesCurrentSource,true);}
    assert.equal(native[platform].storeSubmitted,false);
  }
});

test('current release preserves historical publication evidence and labels its scope',()=>{
  const release=json(releasePath);
  assert.deepEqual(release.recorded_release_evidence,json('docs/release-evidence-2026-09-13.json'));
  const context=release.recorded_release_evidence_context;
  assert.equal(context.classification,'historical');
  assert.equal(context.source,'/downloads/release-evidence-2026-09-13.json');
  assert.equal(context.latestReleaseManifest,'/v4/release/manifest');
  assert.equal(context.currentNativeDistribution,'/downloads/native-package-record-v4.json');
  assert.equal(context.deploymentOfCurrentBuildVerified,false);
});

test('release and client manifests bind the identical treasury verifier without provider claims',()=>{
  const release=json(releasePath),alignment=json('dist/client/source-alignment.json');
  const distribution=json('integrations/numina/distribution.json');
  const binding=release.treasury_client_verification;
  assert.ok(binding,'Current release must declare its treasury client verification binding');
  assert.deepEqual(alignment.treasury_client_verification,binding);
  assert.deepEqual(distribution.treasury_client_verification,binding);
  assert.equal(binding.schema,'numina.treasury.client-verification.v1');
  assert.equal(binding.verifier.sha256,digest(bytes('public/treasury-proof.js')));
  assert.equal(binding.verifier.sha256,digest(bytes('integrations/numina/src/treasury-proof.js')));
  assert.equal(binding.independentProviderVerification,false);
  assert.equal(binding.financialExecutionEnabled,false);
});

test('runtimeBuild preserves optional treasury verification as server-reported metadata',async()=>{
  const release=json(releasePath),calls=[];let include=true;
  assert.ok(release.treasury_client_verification,'Fixture must contain the generated current binding');
  const client=new NuminaClient({baseUrl:'https://numina.test',fetch:async(url,options)=>{
    calls.push({url,method:options.method,authorization:options.headers.Authorization});
    const response=structuredClone(release);
    if(!include)delete response.treasury_client_verification;
    return Response.json(response);
  }});
  const current=await client.runtimeBuild();
  assert.deepEqual(current.data.treasury_client_verification,release.treasury_client_verification);
  assert.equal(current.verification,'server_reported_not_independently_verified');
  assert.equal(current.asset_execution_available,false);
  assert.equal(current.data.current_financial_status_checked,false);
  include=false;
  const legacy=await client.runtimeBuild();
  assert.equal(Object.hasOwn(legacy.data,'treasury_client_verification'),false);
  assert.equal(legacy.verification,'server_reported_not_independently_verified');
  assert.equal(legacy.asset_execution_available,false);
  assert.deepEqual(calls,Array.from({length:2},()=>({url:'https://numina.test/v4/release/manifest',method:'GET',authorization:undefined})));
});
