import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {CONTROL_STORAGE} from '../src/control-store.js';
import {NUMINA_LAYERS} from '../public/architecture-layers.js';
import {NUMINA_OWNER_APPROVAL} from '../public/owner-approval.js';
import {WALLET_EXECUTION_POLICY} from '../public/wallet-execution-policy.js';

test('NUMINA is the canonical active identity',()=>{
  for(const field of ['root','manifest','identity','database','storage','transactionAuthority','journal']){
    assert.equal(CONTROL_STORAGE[field],'NUMINA');
  }
  for(const field of ['identity','transactionAuthority','journal','storage','revisionModel','evidenceHead']){
    assert.equal(NUMINA_LAYERS.database[field],'NUMINA');
  }
  for(const field of ['identity','repository','build','release','deployment']){
    assert.equal(NUMINA_LAYERS.distribution[field],'NUMINA');
  }
  const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  assert.equal(pkg.scripts['release:numina'],'node scripts/package-github-release.mjs');
  assert.equal(pkg.numina.finalBuildManifest.role,'synchronized_projection');
  assert.equal(pkg.numina.finalBuildManifest.synchronization,'ACROSS_ALL');
  const FINAL_BUILD_MANIFEST_BLOB='405f25727a95cfb2e74beac6e9483b071dbb694b';
  const finalBuildUrl=new URL('../public/final-build.json',import.meta.url);
  const finalBuildBytes=readFileSync(finalBuildUrl);
  const finalBuildBlob=createHash('sha1').update(Buffer.concat([Buffer.from('blob '+finalBuildBytes.length+'\\0'),finalBuildBytes])).digest('hex');
  assert.equal(finalBuildBlob,FINAL_BUILD_MANIFEST_BLOB);
  const finalBuild=JSON.parse(finalBuildBytes.toString('utf8'));
  assert.equal(finalBuild.schema,'numina.final-build.v1');
  assert.equal(finalBuild.identity,'NUMINA');
  assert.equal(finalBuild.status,'FINAL');
  assert.equal(finalBuild.applicationVersion,pkg.version);
  assert.equal(finalBuild.buildModel.finalCount,1);
  assert.equal(finalBuild.buildModel.finalIdentity,'NUMINA');
  assert.equal(finalBuild.buildModel.canonicalHeadIdentity,'NUMINA');
  assert.equal(finalBuild.manifestContract.schema,'numina.final-build.contract.v2');
  assert.equal(finalBuild.manifestContract.identity,'NUMINA');
  assert.equal(finalBuild.manifestContract.status,'FINAL');
  assert.equal(finalBuild.manifestContract.finalAll,'NUMINA');
  assert.equal(finalBuild.manifestContract.role,'synchronized_projection');
  assert.equal(finalBuild.manifestContract.synchronization,'ACROSS_ALL');
  assert.equal(NUMINA_OWNER_APPROVAL.requestSha256,'b55cf6c460c0d69ea29645a6bfcfee03b88a4ed2b77b2e3f44ed53ea325956c4');
  assert.equal(NUMINA_OWNER_APPROVAL.issuerPolicySha256,'2134617c4fb7a538271dcf6b3b4bfa10fc71c23631a9cf63c7d0a05ee05294f5');
  assert.equal(WALLET_EXECUTION_POLICY.decimals,18);
  assert.equal(WALLET_EXECUTION_POLICY.initialSupplyNusd,'1500000000000000');
  assert.equal(WALLET_EXECUTION_POLICY.initialSupplyBaseUnits,'1500000000000000000000000000000000');
  assert.equal(WALLET_EXECUTION_POLICY.requestSha256,NUMINA_OWNER_APPROVAL.requestSha256);
  assert.equal(WALLET_EXECUTION_POLICY.artifactSha256,'3e9d8f22014cb1a2496cba9bef334b0146a073c07d84382752a31d586d7658c2');
  assert.equal(WALLET_EXECUTION_POLICY.creationSha256,'1b07ec294a2fe3d38f12d2458efde3cbdeadc056ea096db0ee665ec68173906a');
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
  let declarations=0;
  for(const name of readdirSync(workflowsUrl).filter(name=>/\\.ya?ml$/i.test(name))){
    const content=readFileSync(new URL(name,workflowsUrl),'utf8');
    const targets=[...content.matchAll(/^\\s*runs-on:\\s*(.+?)\\s*(?:#.*)?$/gm)].map(match=>match[1].trim().replace(/^['"]|['"]$/g,''));
    declarations+=targets.length;
    for(const target of targets)assert.equal(target,'NUMINA',name+' runner target must be NUMINA');
  }
  assert.equal(declarations,policy.preservedRunnerCount,'runner count must remain preserved with no future additions');
});
