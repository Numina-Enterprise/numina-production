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
 const config=json('config/numina-routing.json');assert.equal(config.identity,'NUMINA');assert.equal(config.publicOrigin,'https://numinalabs.xyz');assert.deepEqual(config.canonicalSource,{identity:'NUMINA',root:'NUMINA',squareRoot:'NUMINA',role:'ROOT_SOURCE_OF_TRUTH',updateDirection:'ROOT_TO_LEAVES'});assert.equal(config.tree.root,'NUMINA');assert.equal(config.tree.squareRoot,'NUMINA');assert.equal(config.tree.sourceOfTruth,'NUMINA');assert.equal(config.tree.updateDirection,'ROOT_TO_LEAVES');assert.deepEqual(config.tree.leaves.github,{role:'ARCHIVE_LEAF',transport:'github',repository:'skott34-dot/numina-production',branch:'main',authoritative:false,evidenceTransport:true,ciTransport:false,ref:'refs/heads/main',headResolution:'FROZEN_AT_ARCHIVE',ingestIntoTree:false,ingestRole:'ARCHIVE_STATE_REFERENCE',authorityTransferred:false});assert.deepEqual(config.tree.ingestPolicy,{mode:'REFERENCE_SNAPSHOT',canonicalizedBy:'NUMINA',authorityTransferred:false,leafInputsAllowed:false});
 for(const source of ['/wallet-signing','/wallet-signing.html','/deployment-readiness'])assert.equal(config.redirects.find(r=>r.source===source),undefined);
 assert.equal(config.rewrites.find(r=>r.source==='/api/control/v1/:path*')?.destination,'https://personal-space-m7q9.skott34.chatgpt.site/api/control/v1/:path*');
 for(const version of ['2','3','4'])assert.equal(config.rewrites.find(r=>r.source==='/v'+version+'/release/manifest')?.destination,'/api/application-release');
});

test('root release manifest binds the owner workflow, additive migration and actual blocked policy',()=>{
 const release=json(releasePath),binding=release.owner_wallet_execution;
 assert.equal(binding.schema,'numina.owner-wallet.release-binding.v1');assert.deepEqual(binding.policy,WALLET_EXECUTION_POLICY);assert.equal(binding.submission_enabled,false);
 assert.equal(binding.owner_endpoint,'/api/control/v1/nusd-deployment');assert.equal(binding.final_confirmation,'owner_wallet');
 for(const name of ['model','policy','receipt','ui'])assert.equal(binding.modules[name].sha256,digest(bytes('public/wallet-execution-'+name+'.js')));
 assert.equal(binding.receipt_verification.minimum_confirmations,12);assert.equal(binding.receipt_verification.scope,'provider_observation_consistency');
 assert.equal(binding.attempt_storage.migration_sha256,digest(bytes('drizzle/0004_wallet_deployment_intents.sql')));assert.equal(binding.attempt_storage.native_journal_modified,false);
 assert.equal(release.compatibility.data_migration_required,true);assert.deepEqual(release.compatibility.additive_migrations,['0004_wallet_deployment_intents','0005_numina_manifest_control']);
 assert.deepEqual(binding.evidence,{signature:null,transaction_hash:null,receipt:null,mint_verified:false,provider_deposit_verified:false,reserves_verified:false});
 assert.deepEqual(release.scope,{
  financial_execution_activated_by_this_release:false,
  nusd_issuance_activated_by_this_release:false,
  nusd_issuance_verified_in_current_state:false,
  contract_deployment_verified_in_current_state:false,
  reserve_verification_established_by_this_release:false,
  external_settlement_activated_by_this_release:false
 });
 const receipts=release.nusd_transaction_receipts,mint=json('runtime/nusd/mint-receipt.json'),deployment=json('runtime/nusd/deployment-receipt.json');
 assert.equal(receipts.historicalRecord,true);assert.equal(receipts.currentChainStateVerified,false);
 assert.equal(receipts.deployment.transaction_hash,mint.transactionHash);assert.equal(receipts.deployment.amount_nusd,mint.amountNusd);
 assert.equal(receipts.deployment.decimals,mint.decimals);assert.equal(receipts.deployment.base_units,mint.baseUnits);
 assert.equal(receipts.deployment.historicalRecord,true);assert.equal(receipts.deployment.currentChainStateVerified,false);
 assert.equal(receipts.deployment.verification.status,'verified_at_observation');
 assert.equal(receipts.settlement.transaction_hash,deployment.settlement.transactionHash);
 assert.equal(receipts.settlement.historicalRecord,true);assert.equal(receipts.settlement.currentChainStateVerified,false);
 assert.equal(receipts.settlement.verification.status,'verified_at_observation');assert.equal(receipts.settlement.financial_settlement_verified,false);
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
  assert.equal(release.identity,'NUMINA');
  for(const field of ['root','manifest','authority','source','evidence','provider','core','worker','journal','runtime','artifact','authentication','delivery','readiness','treasury'])assert.equal(release.compatibility.identity_aliases[field],'NUMINA',field);
  assert.equal(release.provider_verification,true);
  assert.equal(release.softwareExternal,false);
  assert.equal(release.softwareIdentity,'NUMINA');
  const softwareTreasury=release.softwareTreasury;
  assert.equal(softwareTreasury.identity,'NUMINA');assert.equal(softwareTreasury.singular,true);
  assert.deepEqual(Object.keys(softwareTreasury).sort(),['aggregate','bankUsd','identity','nativeNusd','singular','stripeUsdc']);
  const {historicalTransfer,...bankUsd}=softwareTreasury.bankUsd;
  assert.deepEqual(bankUsd,{current:null,available:null,unit:'USD'});
  assert.equal(historicalTransfer.providerObservationVerified,true);assert.equal(historicalTransfer.providerBalanceSnapshotCurrent,'0');
  assert.equal(historicalTransfer.providerBalanceSnapshotAvailable,'0');assert.equal(historicalTransfer.providerObservationFreshness,'unknown');
  for(const key of ['providerBalanceCurrentVerified','providerTransactionCurrentVerified','providerAmountMatchesSoftwareModel','providerBalanceMatchesSoftwareModel','externalFundsMovedVerified','externalSettlementVerified'])assert.equal(historicalTransfer[key],false,key);
  assert.deepEqual(softwareTreasury.stripeUsdc,{current:null,available:null,unit:'USDC',modeledTarget:'500000000000000'});
  assert.deepEqual(softwareTreasury.nativeNusd,{current:'500000000000000',available:null,unit:'NUSD',observationRevision:142});
  assert.deepEqual(softwareTreasury.aggregate,{current:'500000000000000',unit:'NUSD',observationRevision:142,modeledTarget:'1500000000000000'});
  const canonical=release.canonicalTreasuryValues;
  assert.equal(canonical.status,'JOURNAL_SNAPSHOT');assert.equal(canonical.canonical,false);
  assert.equal(canonical.observation.observedRevision,142);assert.equal(canonical.observation.snapshotIsLive,false);
  assert.equal(canonical.observation.observedHead,'67b45a040374d944f42f26830c4a9142e26fa194d5149b7cfad2604aef351368');
  assert.equal(canonical.observation.projection.balance,softwareTreasury.nativeNusd.current);
  assert.deepEqual(canonical.observation.requests.map(({kind,status,submission_performed,receipt})=>({kind,status,submission_performed,receipt})),[
   {kind:'mint_request',status:'PREPARED',submission_performed:false,receipt:null},
   {kind:'bank_transaction_request',status:'PREPARED',submission_performed:false,receipt:null}
  ]);
  assert.equal(canonical.observation.baseUsdcTransferRequest,null);assert.equal(canonical.observation.baseUsdcTransactionHash,null);
  assert.equal(canonical.observation.providerReceipt,null);assert.equal(canonical.settlementStatus,'UNVERIFIED');
  const nativeModel=release.native_treasury_alignment;
  assert.equal(nativeModel.aggregation,'ONE_JOURNAL_NUSD_PROJECTION_WITH_HISTORICAL_ALLOCATION_TARGETS');
  assert.equal(nativeModel.treasuryCount,1);assert.equal(nativeModel.accountCount,1);assert.equal(nativeModel.holdingsCount,3);
  assert.equal(nativeModel.status,'JOURNAL_SNAPSHOT');assert.equal(nativeModel.aggregateModeledValue,null);assert.equal(nativeModel.modeledAllocationsAdditive,false);
  assert.equal(BigInt(nativeModel.historicalAggregateModeledValue),BigInt(nativeModel.targetAmount)*3n);
  assert.deepEqual(nativeModel.componentUnits,['USD','USDC','NUSD']);
  assert.equal(nativeModel.verificationScope,'NUMINA_NATIVE_TREASURY_JOURNAL_SNAPSHOT');
  assert.equal(nativeModel.originalSignedEventsRetained,true);assert.equal(nativeModel.settlementStatus,'UNVERIFIED');
  assert.equal(nativeModel.mintStatus,'PREPARED_IN_JOURNAL');assert.equal(nativeModel.mintedNusd,null);assert.equal(nativeModel.burnedNusd,null);
  assert.equal(nativeModel.externalBalancesAggregated,false);assert.equal(nativeModel.externalFundingCreatedByRelease,false);
});

test('current settlement validation binds the retained owner assertion without treating it as an executed settlement',()=>{
  const release=json(releasePath),current=release.current_treasury_settlement;
  const validation=json(current.validationSource),historical=json(current.historicalOwnerAssertion);
  assert.equal(digest(bytes(current.historicalOwnerAssertion)),'783486abc7dae3a4eacf42c2afc582d723cdba0dc7594eb6f01574cc7cb39be9');
  assert.equal(historical.status,'SETTLED');assert.equal(historical.settlementPerformed,true);assert.equal(historical.submissionPerformed,true);
  assert.equal(current.schema,validation.schema);assert.equal(current.id,validation.id);assert.equal(current.validatesAssertionId,historical.id);
  assert.equal(current.status,validation.status);assert.equal(current.status,'NOT_SETTLED');assert.equal(current.final,true);
  assert.equal(current.journalAuthenticated,validation.journalAuthentication.authenticated);assert.equal(current.journalAuthenticated,false);
  assert.equal(validation.journalAuthentication.revisionChecked,142);assert.equal(validation.journalAuthentication.matchingEventCount,0);
  assert.equal(validation.journalAuthentication.aggregateSettlementEventPresent,false);
  for(const key of ['submissionPerformed','settlementPerformed','externalFundsMoved']){
   assert.equal(current[key],validation.executionVerification[key],key);assert.equal(current[key],false,key);
  }
  assert.equal(current.mintEvidenceScope,validation.verifiedEvidence.nusdMintEvidenceScope);
  assert.equal(current.mintEvidenceScope,'NUSD_CONSTRUCTOR_MINT_ONLY');assert.equal(validation.verifiedEvidence.nusdConstructorMint,true);
  const native=release.native_treasury_alignment;
  assert.equal(native.historicalSettlementReceipt.id,historical.id);assert.equal(native.historicalSettlementReceipt.historicalRecord,true);
  assert.equal(native.historicalSettlementReceipt.currentJournalConfirmed,false);
  assert.equal(native.settlementReceiptValidation.id,current.id);assert.equal(native.settlementReceiptValidation.executionVerified,false);
  assert.equal(native.settlementReceiptValidation.settlementVerified,false);assert.equal(native.settlementReceiptValidation.providerSettlementVerified,false);
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
    const {current_source,source_archive_current,...recorded}=distribution[platform];
    assert.deepEqual(recorded,native[platform],platform);
    assert.equal(native[platform].sourceCommit,platform==='ios'?'c6ffbb50d77ff53323b71b7048872637677e6b42':'cd28af207f39fe8ba010ef83eafbd832448ffbbf');
    if(platform==='ios'){
      assert.equal(native[platform].currentSourceCompiled,false);assert.equal(native[platform].signingInputMatchesCurrentSource,false);
      assert.equal(source_archive_current,current_source.sourceInputsSha256===native[platform].sourceInputsSha256);assert.equal(current_source.buildNumber,6);
    }
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
  assert.equal(binding.schema,'numina.treasury.client-verification.v2');
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

