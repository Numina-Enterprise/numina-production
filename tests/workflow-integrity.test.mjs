import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=new URL('../',import.meta.url);
const workflowDirectory=new URL('.github/workflows/',root);
const providerWorkflow=()=>readFileSync(new URL('verify-provider-observations.yml',workflowDirectory),'utf8');

test('CI runner checker accepts the preserved execution substrates and singular NUMINA identity',()=>{
  const result=execFileSync(process.execPath,['scripts/check-runner-policy.mjs'],{cwd:fileURLToPath(root),encoding:'utf8'});
  assert.match(result,/NUMINA runners preserved: 27/);
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

test('signed runtime readiness must pass before a trusted release record is built or persisted',()=>{
  const steps=providerWorkflow().split(/(?=^      - )/m);
  const gate=steps.findIndex(step=>/^        run: node scripts\/check-runtime\.mjs\s*$/m.test(step));
  const build=steps.findIndex(step=>/^        run: node scripts\/build-trusted-production-release\.mjs\s*$/m.test(step));
  const persist=steps.findIndex(step=>step.includes('- name: Persist and verify trusted production release gate'));
  assert.ok(gate>=0&&build>gate&&persist>build,'Runtime evidence must gate trusted release creation and persistence');
  assert.match(steps[gate],/^        if: github.event_name == 'push' && github.ref == 'refs\/heads\/main'\s*$/m);
  assert.doesNotMatch(steps[gate],/continue-on-error|\|\|\s*true/,'Missing readiness evidence must remain a failure');
});
