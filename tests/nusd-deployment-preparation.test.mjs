import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
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
 // The finalized token uses 18 decimals; this is independent of the six-decimal historical review.
 assert.equal(args[0],500000000000000000001000000000000n);assert.equal(args[1],123000001000000000000n);assert.equal(args[2],f.config.initialRecipient);
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

test('retained production request and policy mismatches fail closed without altering historical bytes',()=>{
 const request=path.join(root,'runtime/nusd/deployment.production.json'),receipt=path.join(root,'runtime/nusd/deployment-receipt.json');
 const requestConfig=JSON.parse(fs.readFileSync(request)),policy=path.resolve(path.dirname(request),requestConfig.issuer.approvedPolicyFile);
 const files=[request,receipt,policy],before=files.map(file=>hash(fs.readFileSync(file))),checked=validateDeployment(request);
 assert.equal(checked.deploymentScope,'retained_deployment_receipt_binding.v1');assert.equal(checked.productionDispatchAllowed,false);
 assert.ok(checked.errors.some(error=>/^RETAINED_PRODUCTION_(?:REQUEST|POLICY)_EVIDENCE_MISMATCH/.test(error)));
 assert.deepEqual(files.map(file=>hash(fs.readFileSync(file))),before);
});

test('production CLI rejects blocked retained requests and explicit unsigned candidates before signer or network access',t=>{
 const deploy=path.join(root,'runtime/nusd/scripts/deploy-production.mjs'),f=fixture(t);
 const invoke=request=>{
  const code=`let networkCalls=0;globalThis.fetch=async()=>{networkCalls++;throw Error('TEST_NETWORK_CALL_REJECTED');};process.argv=[process.execPath,${JSON.stringify(deploy)}${request?','+JSON.stringify(request):''}];try{await import(${JSON.stringify(pathToFileURL(deploy).href)});process.stdout.write(JSON.stringify({unexpectedSuccess:true,networkCalls}));process.exitCode=1;}catch(error){process.stdout.write(JSON.stringify({error:error.message,networkCalls}));}`;
  const result=spawnSync(process.execPath,['--input-type=module','--eval',code],{cwd:root,encoding:'utf8',timeout:10000,env:{...process.env,NUMINA_RPC_URL:'https://deployment-preflight.invalid',NUMINA_RPC_AUTHORIZATION:'TEST_ONLY',NUMINA_EXPECTED_CHAIN_ID:'962421430',NUMINA_EXPECTED_GENESIS:'0x'+'0'.repeat(64),NUMINA_SENDER:'INVALID_SIGNER_MUST_NOT_BE_READ'}});
  assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);
 };
 const retained=invoke();assert.equal(retained.networkCalls,0);assert.match(retained.error,/^DEPLOYMENT_REQUEST_INVALID:.*RETAINED_PRODUCTION_/);
 const candidate=validateDeployment(f.file);assert.deepEqual(candidate.errors,[]);assert.equal(candidate.deploymentScope,'explicit_unsigned_candidate.v1');assert.equal(candidate.productionDispatchAllowed,false);
 const explicit=invoke(f.file);assert.equal(explicit.networkCalls,0);assert.match(explicit.error,/^PRODUCTION_DISPATCH_REQUIRES_RETAINED_RECEIPT_BINDING/);assert.equal(fs.existsSync(f.output),false);
});
