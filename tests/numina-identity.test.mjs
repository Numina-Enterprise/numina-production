import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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
  const FINAL_BUILD_MANIFEST_BLOB='c7533c4609b90967a987a4c2369dd1c85b998c47';
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
  assert.equal(NUMINA_OWNER_APPROVAL.requestSha256,'b55cf6c460c0d69ea29645a6bfcfee03b88a4ed2b77b2e3f44ed53ea325956c4');
  assert.equal(NUMINA_OWNER_APPROVAL.issuerPolicySha256,'2134617c4fb7a538271dcf6b3b4bfa10fc71c23631a9cf63c7d0a05ee05294f5');
  assert.equal(WALLET_EXECUTION_POLICY.decimals,18);
  assert.equal(WALLET_EXECUTION_POLICY.initialSupplyNusd,'1500000000000000');
  assert.equal(WALLET_EXECUTION_POLICY.initialSupplyBaseUnits,'1500000000000000000000000000000000');
  assert.equal(WALLET_EXECUTION_POLICY.requestSha256,NUMINA_OWNER_APPROVAL.requestSha256);
  assert.equal(WALLET_EXECUTION_POLICY.artifactSha256,'3e9d8f22014cb1a2496cba9bef334b0146a073c07d84382752a31d586d7658c2');
  assert.equal(WALLET_EXECUTION_POLICY.creationSha256,'1b07ec294a2fe3d38f12d2458efde3cbdeadc056ea096db0ee665ec68173906a');
});
