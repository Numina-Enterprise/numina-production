import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {privateBankRouteConfiguration} from '../src/bank-route-model.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url));
const json=path=>JSON.parse(read(path));
const bytes=read('public/final-build.json'),finalBuild=JSON.parse(bytes);
const blob=createHash('sha1').update(Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes])).digest('hex');
assert.equal(json('package.json').numina.finalBuildManifest.blob,blob,'package FINAL pin');
for(const path of ['scripts/build.mjs','scripts/package-github-release.mjs','.github/workflows/numina.yml']){
  assert.ok(read(path).toString().includes(blob),path+' FINAL pin');
}
assert.deepEqual(json('docs/NUMINA-FINAL-BUILD.json'),finalBuild,'current FINAL download is stale');
assert.equal(finalBuild.identity,'NUMINA');
assert.equal(finalBuild.treasury.identity,'NUMINA','execution-specific identity must not leak globally');
assert.equal(finalBuild.status,'FINAL');
const recordPath='release-evidence/numina-bofa-ach-instruction-2026-09-19.json';
const instruction=json(recordPath),projection=finalBuild.treasury.achTransferInstruction;
assert.equal(projection.record,recordPath);
assert.equal(projection.id,instruction.id);
for(const key of ['amountNusd','targetAmountUsd','ratio','contract','nativeContractId'])assert.equal(projection[key],instruction[key],key);
const fields={endpoint:'073000176',endpointIdentity:'SK Consulting LLC',treasuryIdentity:'NUMINA NATIVE TREASURY',achOriginatorIdentity:'NUMINA',instructionState:'INITIATED'};
for(const item of [instruction,projection]){
  for(const [key,value] of Object.entries(fields))assert.equal(item[key],value,key);
  assert.equal(item.status,'INITIATED');
  assert.equal(item.executionScope,'THIS_ACH_EXECUTION_ONLY');
  for(const key of ['achOriginatorSubmissionPerformed','externalAchOriginatorConfirmed','numinaExecutionPerformed','providerSubmissionVerified','networkSubmissionVerified','bankSettlementVerified'])assert.equal(item[key],false,key+' lacks external evidence');
  for(const key of ['achOriginatorReceipt','achTraceNumber','providerConfirmationId','achOriginatorSubmissionSource'])assert.equal(item[key],null,key+' lacks external evidence');
}
assert.equal(instruction.destination.routingReference,fields.endpoint);
assert.equal(projection.routingReference,fields.endpoint);
const bank=privateBankRouteConfiguration({});
for(const [key,value] of Object.entries(fields))assert.equal(bank.achExecutionScope[key],value,key);
assert.equal(bank.treasuryIdentity,'NUMINA');
assert.equal(bank.achInstructionStatus,'INITIATED');
assert.equal(bank.achSubmissionEnabled,false);
assert.equal(bank.settlementPerformed,false);
assert.equal(bank.bankSettlementVerified,false);
console.log('FINAL manifest, pins and execution-only ACH scope agree; no external execution asserted.');
