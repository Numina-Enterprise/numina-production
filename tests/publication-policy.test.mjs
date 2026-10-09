import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

const root=new URL('../',import.meta.url);
const read=p=>readFileSync(new URL(p,root));
const json=p=>JSON.parse(readFileSync(new URL(p,root),'utf8'));

test('canonical repository release is bound to the tagged source and exact bytes',()=>{
  const release=json('releases/v4.0.0/release.json');
  const archive=read('releases/v4.0.0/numina-release-v4.0.0.tar.gz');
  assert.equal(release.schema,'numina.repository-release.v1');
  assert.equal(release.identity,'NUMINA');
  assert.equal(release.version,'4.0.0');
  assert.equal(release.tag,'v4.0.0');
  assert.equal(release.sourceCommit,'c57106e8bafd8078873b777587f748da6be86a32');
  assert.equal(release.githubReleaseObjectRequired,false);
  assert.equal(archive.length,release.bytes);
  assert.equal(createHash('sha256').update(archive).digest('hex'),release.sha256);
  const tagged=execFileSync('git',['rev-list','-n','1','v4.0.0'],{cwd:new URL('..',import.meta.url),encoding:'utf8'}).trim();
  assert.equal(tagged,release.sourceCommit);
});

test('Numina public origin is downstream of the canonical NUMINA repository',()=>{
  const policy=json('public/publication-policy.json');
  assert.equal(policy.schema,'numina.publication-policy.v1');
  assert.equal(policy.authoritativePublicOrigin,'https://numinalabs.xyz');
  assert.equal(policy.authoritativeHosting,'NUMINA_PUBLIC_ORIGIN');
  assert.equal(policy.canonicalSource,'NUMINA_REPOSITORY');
  assert.equal(policy.repository,'NUMINA');
  assert.equal(policy.repositoryRole,'CANONICAL_ROOT_REPOSITORY');
  assert.equal(policy.propagation,'NUMINA');
  assert.equal(policy.chatgptSitesRole,'OPTIONAL_MIRROR');
  assert.equal(policy.chatgptSitesRequiredForRelease,false);
  assert.equal(policy.mobileStoreDistributionRequiredForWebRelease,false);
  assert.equal(policy.externalFinancialExecutionRequired,false);
});