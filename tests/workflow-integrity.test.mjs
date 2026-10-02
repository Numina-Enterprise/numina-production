import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=new URL('../',import.meta.url);
const workflowDirectory=new URL('.github/workflows/',root);
const providerWorkflow=()=>readFileSync(new URL('verify-provider-observations.yml',workflowDirectory),'utf8');

test('NUSD artifact validation workflow cannot rewrite pins, create canonical drafts or push commits',()=>{
  const workflow=readFileSync(new URL('rebuild-nusd-artifacts.yml',workflowDirectory),'utf8').replaceAll('\r\n','\n');
  assert.match(workflow,/permissions:\n  contents: read\n/);
  assert.match(workflow,/persist-credentials: false/);
  assert.match(workflow,/group: rebuild-nusd-\$\{\{ github\.ref \}\}/);
  assert.match(workflow,/cancel-in-progress: true/);
  assert.doesNotMatch(workflow,/contents:\s*write|git\s+(?:commit|push|add|config)|refresh-token-pins|prepare-review-draft|unsigned-production-deployment|production-review-draft|--candidate-output|--output|6DEC/i);
  const steps=workflow.split(/(?=^      - )/m);
  const compiler=steps.findIndex(step=>step.includes('- name: Validate retained compiler artifact pins'));
  const receipts=steps.findIndex(step=>step.includes('- name: Validate retained 18-decimal receipt bindings'));
  const contracts=steps.findIndex(step=>step.includes('- name: Test contract implementation locally'));
  const guard=steps.findIndex(step=>step.includes('- name: Verify retained source and evidence were not changed'));
  const upload=steps.findIndex(step=>step.includes('- name: Upload validated retained artifacts and receipts'));
  assert.ok(compiler>=0&&receipts>compiler&&contracts>receipts&&guard>contracts&&upload>guard,'All retained-artifact validation must pass before upload');
  assert.match(steps[compiler],/run: npm run compile/);
  assert.match(steps[contracts],/working-directory: runtime\/nusd\/development\n        run: npm test/);
  assert.match(steps[guard],/run: git diff --exit-code -- runtime\/nusd\/contracts runtime\/nusd\/artifacts/);
  assert.doesNotMatch(workflow,/continue-on-error|\|\|\s*true/);
  assert.match(steps[upload],/name: NUSD-18DEC-RETAINED-RECEIPT-BOUND-ARTIFACTS/);
  for(const file of ['deployment-receipt.json','deployment-verification.json','mint-receipt.json','scripts/token-artifact.mjs'])assert.ok(steps[upload].includes('runtime/nusd/'+file));
});

test('NUSD workflow validates its actual 18-decimal receipt-bound inputs without changing retained bytes',()=>{
  const workflow=readFileSync(new URL('rebuild-nusd-artifacts.yml',workflowDirectory),'utf8').replaceAll('\r\n','\n');
  const match=workflow.match(/^          node --input-type=module <<'NODE'\n([\s\S]*?)^          NODE$/m);
  assert.ok(match,'Receipt validation must execute an explicit Node module');
  const code=match[1].replace(/^ {10}/gm,'');
  const retained=['scripts/token-artifact.mjs','deployment-receipt.json','deployment-verification.json','mint-receipt.json'];
  for(const contract of ['NuminaUSD','NuminaSettlement','NuminaUSDCConversion','NuminaUSDRedemption'])retained.push('contracts/'+contract+'.sol','artifacts/'+contract+'.json');
  const snapshot=()=>retained.map(file=>readFileSync(new URL('runtime/nusd/'+file,root)));
  const before=snapshot();
  const result=execFileSync(process.execPath,['--input-type=module','-e',code],{cwd:fileURLToPath(root),encoding:'utf8'});
  assert.match(result,/Validated retained 18-decimal source, artifact and receipt bindings/);
  assert.match(result,/current chain state remains unverified; no artifact writes or provider transactions/);
  assert.deepEqual(snapshot(),before);
});

test('CI runner checker accepts the preserved execution substrates and singular NUMINA identity',()=>{
  const result=execFileSync(process.execPath,['scripts/check-runner-policy.mjs'],{cwd:fileURLToPath(root),encoding:'utf8'});
  assert.match(result,/NUMINA runners preserved: 33/);
});

test('all external workflow dependencies satisfy the immutable action policy',()=>{
  const mutable=[];
  for(const file of readdirSync(workflowDirectory).filter(name=>/\.ya?ml$/.test(name))){
    const lines=readFileSync(new URL(file,workflowDirectory),'utf8').split(/\r?\n/);
    for(let index=0;index<lines.length;index++){
      const match=lines[index].match(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/);
      if(!match)continue;
      const reference=match[1].replace(/^["']|["']$/g,'');
      if(!reference.startsWith('./')&&!/^.+@[a-f\d]{40}$/i.test(reference))mutable.push(`${file}:${index+1}: ${reference}`);
    }
  }
  assert.deepEqual(mutable,[],'External actions and reusable workflows must use immutable commit references');
});

test('deployment workflow maintenance cannot initiate an on-chain deployment',()=>{
  const workflow=readFileSync(new URL('deploy-nusd-contracts.yml',workflowDirectory),'utf8');
  const push=workflow.slice(workflow.indexOf('  push:'),workflow.indexOf('  workflow_dispatch:'));
  assert.doesNotMatch(push,/^\s*-\s*['"]?\.github\/workflows\//m);
  assert.match(push,/runtime\/nusd\/contracts\/\*\*/);
  assert.match(workflow,/^  workflow_dispatch:/m);
});

test('provider verification workflow invokes existing local verification entrypoints',()=>{
  const workflow=providerWorkflow(),pkg=JSON.parse(readFileSync(new URL('package.json',root),'utf8'));
  for(const [,script]of workflow.matchAll(/\bnode (scripts\/[A-Za-z\d._/-]+\.mjs)/g)){
    assert.equal(existsSync(new URL(script,root)),true,`Missing workflow entrypoint: ${script}`);
  }
  for(const [,script]of workflow.matchAll(/\bnpm run ([A-Za-z\d:._-]+)/g)){
    assert.equal(typeof pkg.scripts?.[script],'string',`Missing workflow package script: ${script}`);
  }
});

test('GitHub Release SHA-256 read-back gates trusted source release creation and publication',()=>{
  const workflow=providerWorkflow(),steps=workflow.split(/(?=^      - )/m);
  const providerPublish=steps.findIndex(step=>step.includes('- name: Publish and read back canonical provider evidence from GitHub Release'));
  const gate=steps.findIndex(step=>step.includes('- name: Verify current Numina source before trusting release'));
  const build=steps.findIndex(step=>/^        run: node scripts\/build-trusted-source-release\.mjs\s*$/m.test(step));
  const trustedPublish=steps.findIndex(step=>step.includes('- name: Publish and read back trusted source release from GitHub Release'));
  assert.ok(providerPublish>=0&&gate>providerPublish&&build>gate&&trustedPublish>build,'GitHub evidence read-back must gate trusted release creation and publication');
  assert.match(workflow,/permissions:\n  contents: write/);
  assert.doesNotMatch(workflow,/NUMINA_PROVIDER_INGEST_URL|NUMINA_TRUSTED_RELEASE_URL|ACTIONS_ID_TOKEN_REQUEST_URL|id-token:\s*write/);
  assert.match(steps[providerPublish],/publish-github-evidence\.mjs/);
  assert.match(steps[trustedPublish],/publish-github-evidence\.mjs/);
  assert.match(steps[gate],/npm run build/);assert.match(steps[gate],/npm test/);assert.doesNotMatch(steps[gate],/continue-on-error|\|\|\s*true/,'Source verification must remain a failure gate');
});
