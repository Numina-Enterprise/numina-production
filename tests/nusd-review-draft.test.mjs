import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {AbiCoder,keccak256} from '../runtime/nusd/node_modules/ethers/lib.esm/index.js';
import {prepareReviewDraft} from '../runtime/nusd/scripts/prepare-review-draft.mjs';
import {validateDeployment} from '../runtime/nusd/scripts/validate-deployment.mjs';
import {loadTokenArtifact} from '../runtime/nusd/scripts/token-artifact.mjs';
import {submitManagedDeploymentOnce} from '../runtime/nusd/scripts/managed-deployment.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const cli=path.join(root,'runtime/nusd/scripts/prepare-review-draft.mjs');
const validator=path.join(root,'runtime/nusd/scripts/validate-deployment.mjs');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(t){
 fs.mkdirSync(path.join(root,'work'),{recursive:true});const dir=fs.mkdtempSync(path.join(root,'work/nusd-draft-test-'));
 t.after(()=>{assert.equal(path.dirname(path.resolve(dir)),path.resolve(root,'work'));assert.ok(path.basename(dir).startsWith('nusd-draft-test-'));fs.rmSync(dir,{recursive:true});});
 const config=JSON.parse(fs.readFileSync(path.join(root,'runtime/nusd/deployment.template.json')));
 Object.assign(config,{supplyCapNusd:'500000000000000',initialSupplyNusd:'500000000000000',initialRecipient:'0x0000000000000000000000000000000000000005',adminDelaySeconds:86400});
 config.network.finalityPolicy='LOCAL FIXTURE: 12 confirmations';
 for(const [index,role]of ['admin','issuer','minter','pauser'].entries())config.roles[role]='0x'+String(index+1).padStart(40,'0');
 const policy='LOCAL TEST POLICY; no external approval.';fs.writeFileSync(path.join(dir,'policy.txt'),policy);
 config.issuer.approvedPolicyFile='policy.txt';config.issuer.policySha256=hash(policy);
 const file=path.join(dir,'request.json'),output=path.join(dir,'draft.json');
 const save=()=>fs.writeFileSync(file,JSON.stringify(config,null,2)+'\n');save();return {dir,config,file,output,save};
}
test('offline review data encodes exact 500T constructor values while all deployment reviews remain open',async t=>{
 const f=fixture(t),draft=await prepareReviewDraft(f.file),artifact=loadTokenArtifact();
 assert.equal(draft.status,'UNSIGNED_REVIEW_DRAFT_NOT_APPROVED');assert.equal(draft.submissionApproved,false);
 assert.equal(draft.review.recordPresenceErrors.length,8);assert.equal(validateDeployment(f.file).errors.length,8);
 assert.equal(draft.integrity.requestSha256,hash(fs.readFileSync(f.file)));
 assert.equal(draft.integrity.creationDataKeccak256,keccak256(draft.transaction.data));
 assert.equal(draft.integrity.creationDataSha256,hash(Buffer.from(draft.transaction.data.slice(2),'hex')));
 assert.ok(draft.transaction.data.startsWith(artifact.bytecode));
 const args=AbiCoder.defaultAbiCoder().decode(artifact.abi.find(x=>x.type==='constructor').inputs,'0x'+draft.transaction.data.slice(artifact.bytecode.length));
 // These tools prepare the finalized 18-decimal contract, not the retired six-decimal review.
 assert.equal(args[0],500000000000000000000000000000000n);assert.equal(args[1],500000000000000000000000000000000n);
 assert.equal(args[2],f.config.initialRecipient);assert.deepEqual(Array.from(args.slice(3,7)),Object.values(f.config.roles));
 assert.equal(args[7],86400n);assert.equal(args[8],'0x'+f.config.issuer.policySha256);
 assert.equal(draft.broadcast,false);assert.equal(draft.signature,null);assert.equal(draft.receipt,null);
 assert.equal(draft.transaction.from,null);assert.equal(draft.transaction.nonce,null);assert.equal(draft.execution.managedManifest,null);
 assert.ok(Object.values(draft.effects).every(value=>value===false));
 const normal=spawnSync(process.execPath,[validator,f.file,'--output',path.join(f.dir,'normal.json')],{encoding:'utf8'});
 assert.equal(normal.status,1);assert.equal(fs.existsSync(path.join(f.dir,'normal.json')),false);
 let rpcCalls=0;
 await assert.rejects(submitManagedDeploymentOnce(draft,hash(JSON.stringify(draft)),{
  rpcUrl:'https://fixture.invalid',fetcher:async()=>{rpcCalls++;throw new Error('Unexpected network call');}
 }),error=>error.code==='INVALID_CONFIG');
 assert.equal(rpcCalls,0);
});
test('draft preparation still rejects changed policies, invalid amounts and reused roles',async t=>{
 const f=fixture(t),original=structuredClone(f.config);
 for(const mutate of [()=>f.config.supplyCapNusd='-1',()=>f.config.initialSupplyNusd='500000000000001',()=>f.config.roles.minter=f.config.roles.issuer,()=>f.config.issuer.policySha256='a'.repeat(64)]){
  Object.assign(f.config,structuredClone(original));mutate();f.save();
  await assert.rejects(prepareReviewDraft(f.file),error=>error.code==='INVALID_CONSTRUCTOR_INPUTS');
 }
 assert.equal(fs.existsSync(f.output),false);
});
test('draft CLI preserves existing output, reuses exact retries, and never interprets review labels as approval',async t=>{
 const f=fixture(t),run=()=>spawnSync(process.execPath,[cli,f.file,'--output',f.output],{encoding:'utf8'});
 let result=run();assert.equal(result.status,0,result.stderr);const bytes=fs.readFileSync(f.output);
 result=run();assert.equal(result.status,0);assert.equal(JSON.parse(result.stdout).reused,true);
 f.config.initialSupplyNusd='1';f.save();result=run();assert.equal(result.status,1);assert.ok(fs.readFileSync(f.output).equals(bytes));
 for(const key of Object.keys(f.config.reviewRecords))f.config.reviewRecords[key]='Owner approval is not an independent audit';f.save();
 const labelled=await prepareReviewDraft(f.file);assert.equal(labelled.review.recordPresenceCheckPassed,true);
 assert.equal(labelled.review.independentReviewsVerified,false);assert.equal(labelled.submissionApproved,false);
});
