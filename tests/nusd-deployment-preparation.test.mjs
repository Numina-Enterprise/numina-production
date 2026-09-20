import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {AbiCoder} from '../runtime/nusd/node_modules/ethers/lib.esm/index.js';
import {validateDeployment} from '../runtime/nusd/scripts/validate-deployment.mjs';
import {loadTokenArtifact,TOKEN_ARTIFACT_SHA256} from '../runtime/nusd/scripts/token-artifact.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const cli=path.join(root,'runtime/nusd/scripts/validate-deployment.mjs');
const template=JSON.parse(fs.readFileSync(path.join(root,'runtime/nusd/deployment.template.json')));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const run=args=>spawnSync(process.execPath,[cli,...args],{cwd:root,encoding:'utf8',timeout:10000});
function fixture(t){
 fs.mkdirSync(path.join(root,'work'),{recursive:true});const dir=fs.mkdtempSync(path.join(root,'work/nusd-prepare-test-'));
 t.after(()=>{assert.equal(path.dirname(path.resolve(dir)),path.resolve(root,'work'));assert.ok(path.basename(dir).startsWith('nusd-prepare-test-'));fs.rmSync(dir,{recursive:true,force:true});});
 const config=structuredClone(template),policy='LOCAL TEST FIXTURE ONLY; no production approval or backing.';
 fs.writeFileSync(path.join(dir,'policy.txt'),policy);
 Object.assign(config,{supplyCapNusd:'500000000000000.000001',initialSupplyNusd:'123.000001',initialRecipient:'0x0000000000000000000000000000000000000005',adminDelaySeconds:3600});
 config.network.finalityPolicy='Local test fixture finality, not a production policy';
 for(const [i,role]of ['admin','issuer','minter','pauser'].entries())config.roles[role]='0x'+String(i+1).padStart(40,'0');
 config.issuer={legalEntity:'Local test issuer',approvedPolicyFile:'policy.txt',policySha256:hash(policy)};
 for(const key of Object.keys(config.reviewRecords))config.reviewRecords[key]='Local test fixture only';
 const file=path.join(dir,'request.json'),output=path.join(dir,'unsigned.json');
 const save=()=>fs.writeFileSync(file,JSON.stringify(config,null,2)+'\n');save();return {dir,file,output,config,save};
}
test('included default template reports missing inputs without a file error or guessed supply',()=>{
 const result=run([]);assert.equal(result.status,1);assert.equal(result.stderr,'');
 const report=JSON.parse(result.stdout);assert.equal(report.valid,false);assert.equal(report.broadcast,false);
 assert.ok(report.errors.some(e=>e.includes('supply cap')));assert.ok(report.errors.some(e=>e.includes('admin address')));
 assert.equal(template.initialSupplyNusd,null);assert.equal(template.initialRecipient,null);
});
test('CLI creates exact unsigned constructor data from a complete isolated fixture',t=>{
 const f=fixture(t),result=run([f.file,'--output',f.output]);assert.equal(result.status,0,result.stderr+result.stdout);
 const output=JSON.parse(fs.readFileSync(f.output)),artifact=loadTokenArtifact();
 assert.equal(output.broadcast,false);assert.equal(output.status,'UNSIGNED_DEPLOYMENT_DATA_ONLY');assert.equal(output.initiallyPaused,true);
 assert.equal(output.requestSha256,hash(fs.readFileSync(f.file)));assert.equal(output.artifactSha256,TOKEN_ARTIFACT_SHA256);
 assert.ok(output.data.startsWith(artifact.bytecode));
 const args=AbiCoder.defaultAbiCoder().decode(artifact.abi.find(e=>e.type==='constructor').inputs,'0x'+output.data.slice(artifact.bytecode.length));
 // The current contract candidate uses six decimals; UI display precision is separate.
 assert.equal(args[0],500000000000000000001n);assert.equal(args[1],123000001n);assert.equal(args[2],f.config.initialRecipient);
 assert.deepEqual(Array.from(args.slice(3,7)),Object.values(f.config.roles));assert.equal(args[7],3600n);assert.equal(args[8],'0x'+f.config.issuer.policySha256);
 assert.equal(output.receipt,null);assert.equal(output.transactionHash,null);assert.equal(output.deployedAddress,null);
});
test('invalid JSON, role reuse, policy changes and excess issuance never produce unsigned output',t=>{
 const f=fixture(t),original=structuredClone(f.config);
 for(const [corrupt,expected]of [[()=>fs.writeFileSync(f.file,'{'),/JSON object/],[()=>{f.config.roles.issuer=f.config.roles.admin;f.save();},/must be distinct/],[()=>{f.config.initialSupplyNusd='999999999999999';f.save();},/initial supply/]]){
  Object.assign(f.config,structuredClone(original));f.save();corrupt();const result=run([f.file,'--output',f.output]);assert.equal(result.status,1);const report=JSON.parse(result.stdout);assert.equal(report.broadcast,false);assert.ok(report.errors.some(e=>expected.test(e)));assert.equal(fs.existsSync(f.output),false);
 }
 Object.assign(f.config,structuredClone(original));f.save();fs.writeFileSync(path.join(f.dir,'policy.txt'),'changed test policy');assert.ok(validateDeployment(f.file).errors.some(e=>e.includes('policy file')));
 const missing=run([path.join(f.dir,'missing.json'),'--output',f.output]);assert.equal(missing.status,1);assert.equal(missing.stderr,'');
});
