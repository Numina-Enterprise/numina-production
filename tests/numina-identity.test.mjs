import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {CONTROL_STORAGE} from '../src/control-store.js';
import {NUMINA_LAYERS} from '../public/architecture-layers.js';
import {NUMINA_OWNER_APPROVAL} from '../public/owner-approval.js';
import {WALLET_EXECUTION_POLICY} from '../public/wallet-execution-policy.js';
import {NUMINA_TREASURY_CURRENT_POLICY} from '../src/treasury-policy.js';
import {NUMINA_NATIVE_TREASURY_SYNC} from '../public/treasury-connection-model.js';

test('NUMINA identity and dated journal metadata remain aligned',()=>{
  for(const field of ['root','manifest','identity','database','storage','transactionAuthority','journal'])assert.equal(CONTROL_STORAGE[field],'NUMINA');
  for(const field of ['identity','transactionAuthority','journal','storage','revisionModel','evidenceHead'])assert.equal(NUMINA_LAYERS.database[field],'NUMINA');
  for(const field of ['identity','repository','build','release','deployment'])assert.equal(NUMINA_LAYERS.distribution[field],'NUMINA');
  const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  const bytes=readFileSync(new URL('../public/final-build.json',import.meta.url));
  const pin=createHash('sha1').update(Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes])).digest('hex');
  assert.equal(pin,pkg.numina.finalBuildManifest.blob);
  const finalBuild=JSON.parse(bytes.toString('utf8'));
  assert.equal(finalBuild.identity,'NUMINA');
  assert.equal(finalBuild.applicationVersion,pkg.version);
  assert.equal(finalBuild.buildModel.canonicalHeadCount,1);
  assert.equal(finalBuild.treasury.sourceOfTruth,'NUMINA_NATIVE_TREASURY_JOURNAL');
  assert.equal(finalBuild.treasury.journalObservation.observedRevision,142);
  assert.equal(finalBuild.treasury.journalObservation.snapshotIsLive,false);
  assert.equal(finalBuild.treasury.softwareBalanceModel.nativeNusd.current,'500000000000000');
  assert.equal(finalBuild.treasury.softwareBalanceModel.bankUsd.current,null);
  assert.equal(finalBuild.treasury.softwareBalanceModel.stripeUsdc.current,null);
  assert.equal(finalBuild.treasury.aggregateModeledValue,null);
  assert.equal(finalBuild.treasury.settlementStatus,'UNVERIFIED');
  assert.equal(finalBuild.treasury.submissionPerformed,false);
  assert.equal(finalBuild.treasury.canonicalTreasuryValues.settlementReceiptId,null);
  assert.equal(finalBuild.historicalTreasuryRelease.currentJournalConfirmed,false);
  assert.equal(finalBuild.syncAll.aggregateModeledValue,null);
  assert.equal(finalBuild.syncAll.nusdMinted,null);
  assert.equal(finalBuild.nusd.status,'JOURNAL_SNAPSHOT');
  assert.equal(finalBuild.nusd.currentChainState,'UNVERIFIED');
  assert.equal(finalBuild.nusd.nativeBackingVerified,null);
  assert.equal(finalBuild.nusd.journalSubmissionPerformed,false);
  assert.equal(finalBuild.nusd.historicalChainMintEvidence.amountNusd,'1500000000000000');
  assert.equal(finalBuild.historicalNusdRelease.historicalRecord,true);
  assert.equal(NUMINA_NATIVE_TREASURY_SYNC.sourceOfRecord,'NUMINA_NATIVE_TREASURY');
  assert.equal(NUMINA_NATIVE_TREASURY_SYNC.aggregateModeledValue,null);
  assert.equal(NUMINA_NATIVE_TREASURY_SYNC.historicalAggregateModeledValue,'1500000000000000');
  assert.equal(NUMINA_NATIVE_TREASURY_SYNC.nusdLive,null);
  assert.equal(NUMINA_NATIVE_TREASURY_SYNC.contractsActive,null);
  assert.equal(NUMINA_LAYERS.treasury.aggregateModeledValue,null);
  assert.equal(NUMINA_LAYERS.treasury.historicalAggregateModeledValue,'1500000000000000');
  assert.equal(NUMINA_LAYERS.nusd.status,'CURRENT_CHAIN_STATE_UNVERIFIED');
  assert.equal(NUMINA_LAYERS.nusd.nativeBackingVerified,null);
  assert.equal(NUMINA_TREASURY_CURRENT_POLICY.version,3);
  assert.equal(NUMINA_OWNER_APPROVAL.requestSha256,'b55cf6c460c0d69ea29645a6bfcfee03b88a4ed2b77b2e3f44ed53ea325956c4');
  assert.equal(WALLET_EXECUTION_POLICY.requestSha256,NUMINA_OWNER_APPROVAL.requestSha256);
});

test('current NUMINA runners are preserved without freezing placement',()=>{
  const policy=JSON.parse(readFileSync(new URL('../config/numina-runners.json',import.meta.url),'utf8'));
  assert.equal(policy.identity,'NUMINA');
  assert.equal(policy.hostIdentity,'NUMINA');
  assert.equal(policy.runnerIdentity,'NUMINA');
  assert.equal(policy.allRunnerIdentities,'NUMINA');
  assert.equal(policy.runnerTarget,'NUMINA');
  assert.equal(policy.selfHostedPolicy,'preserve_existing');
  assert.equal(policy.futureRunnerPolicy,'deny');
  assert.equal(policy.invariants.preserveCurrentRunners,true);
  assert.equal(policy.invariants.preserveExistingSelfHostedRunners,true);
  assert.equal(policy.invariants.denyFutureRunners,true);
  assert.equal(policy.invariants.allRunnersAreNumina,true);
  assert.equal(policy.invariants.hostIsNumina,true);
  assert.equal(policy.invariants.runnerPlacementFrozen,false);
  const workflowsUrl=new URL('../.github/workflows/',import.meta.url);
  assert.deepEqual(policy.executionTargets.workflowOverrides,{'numina.yml':'ubuntu-latest','publish-sites-control-source.yml':'ubuntu-latest','verify-provider-observations.yml':'ubuntu-latest'});
  assert.equal(policy.executionTargets.default,'NUMINA');
  let declarations=0;
  for(const name of readdirSync(workflowsUrl).filter(name=>/\.ya?ml$/i.test(name))){
    const content=readFileSync(new URL(name,workflowsUrl),'utf8');
    const targets=[...content.matchAll(/^\s*runs-on:\s*(.+?)\s*(?:#.*)?$/gm)].map(match=>match[1].trim().replace(/^['"]|['"]$/g,''));
    declarations+=targets.length;
    for(const target of targets)assert.equal(target,policy.executionTargets.workflowOverrides[name]??policy.executionTargets.default,name+' execution target must match the preserved policy');
  }
  assert.equal(declarations,policy.preservedRunnerCount,'runner count must remain preserved with no future additions');
});


test('NUMINA activation preserves existing runner only',()=>{
  const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  assert.equal(pkg.scripts['runner:activate'],'powershell -NoProfile -ExecutionPolicy Bypass -File scripts/activate-numina-runner.ps1');
  assert.equal(pkg.scripts['runner:status'],'powershell -NoProfile -ExecutionPolicy Bypass -File scripts/activate-numina-runner.ps1 -StatusOnly');
  const activation=readFileSync(new URL('../scripts/activate-numina-runner.ps1',import.meta.url),'utf8');
  assert.match(activation,/NUMINA_RUNNER_NOT_REGISTERED_FUTURE_RUNNER_CREATION_DENIED/);
  assert.doesNotMatch(activation,/registration-token/i);
  assert.doesNotMatch(activation,/config\.cmd/i);
});
