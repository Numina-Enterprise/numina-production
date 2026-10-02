import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const compiler=path.join(root,'runtime/nusd/development/compile.mjs');
const retained=['contracts/NuminaUSD.sol','artifacts/NuminaUSD.json','scripts/token-artifact.mjs','deployment-receipt.json'].map(file=>path.join(root,'runtime/nusd',file));
const read=()=>retained.map(file=>fs.readFileSync(file));

test('retained pin-refresh entrypoint validates 18-decimal receipts without rewriting pins or evidence',()=>{
  const before=read();
  const output=execFileSync(process.execPath,[path.join(root,'runtime/nusd/development/refresh-token-pins.mjs')],{encoding:'utf8'});
  const record=JSON.parse(output.split(/\r?\n/)[0]);
  assert.equal(record.decimals,18);
  for(const flag of ['currentChainStateVerified','pinsRefreshed','artifactWritten','receiptWritten','externalExecutionPerformed'])assert.equal(record[flag],false,flag);
  assert.match(output,/no pin refresh, artifact writes or provider transactions/);
  assert.deepEqual(read(),before);
});

test('contradictory retained receipts block both compiler and old refresh entrypoint without changing protected files',t=>{
  const before=read(),directory=fs.mkdtempSync(path.resolve(root,'../retained-pin-validation-'));
  t.after(()=>{
    assert.equal(path.dirname(path.resolve(directory)),path.resolve(root,'..'));
    assert.ok(path.basename(directory).startsWith('retained-pin-validation-'));
    fs.rmSync(directory,{recursive:true,force:true});
  });
  const copied=['development/refresh-token-pins.mjs','development/compile.mjs','scripts/token-artifact.mjs','contracts/NuminaUSD.sol','artifacts/NuminaUSD.json','deployment-receipt.json'];
  for(const file of copied){
    const destination=path.join(directory,file);fs.mkdirSync(path.dirname(destination),{recursive:true});
    fs.copyFileSync(path.join(root,'runtime/nusd',file),destination);
  }
  const script=path.join(directory,'development/refresh-token-pins.mjs'),copiedCompiler=path.join(directory,'development/compile.mjs'),receiptPath=path.join(directory,'deployment-receipt.json');
  // The default validation path must not invoke a compiler, even when the
  // retained receipt contradicts the protected source and artifact.
  const compilerPackage=path.join(directory,'development/node_modules/solc');
  fs.mkdirSync(compilerPackage,{recursive:true});
  fs.writeFileSync(path.join(compilerPackage,'package.json'),JSON.stringify({name:'solc',type:'module',exports:'./index.js'}));
  fs.writeFileSync(path.join(compilerPackage,'index.js'),"export default {compile(){throw Error('COMPILATION_FORBIDDEN_IN_VALIDATION');},version(){throw Error('COMPILER_VERSION_CALL_FORBIDDEN_IN_VALIDATION');}};");
  assert.match(execFileSync(process.execPath,[copiedCompiler],{encoding:'utf8'}),/no compilation or artifact writes/);
  const receipt=JSON.parse(fs.readFileSync(receiptPath,'utf8'));
  const protectedFiles=copied.filter(file=>file!=='deployment-receipt.json'),snapshot=()=>protectedFiles.map(file=>fs.readFileSync(path.join(directory,file)));
  const protectedBefore=snapshot();
  for(const mutate of [
    value=>value.artifactSha256='0'.repeat(64),
    value=>value.sourceSha256='0'.repeat(64),
    value=>value.issuance.decimals=6,
    value=>value.token.state.decimals=6,
    value=>value.issuance.baseUnits='1',
    value=>value.finality.status='PENDING',
    value=>value.issuance.externallyBackedClaim=true
  ]){
    const changed=structuredClone(receipt);mutate(changed);const bytes=Buffer.from(JSON.stringify(changed));
    fs.writeFileSync(receiptPath,bytes);
    for(const entrypoint of [script,copiedCompiler]){
      const result=spawnSync(process.execPath,[entrypoint],{encoding:'utf8'});
      assert.notEqual(result.status,0);
      assert.match(result.stderr,/RETAINED_TOKEN_RECEIPT_MISMATCH/);
    }
    assert.deepEqual(fs.readFileSync(receiptPath),bytes);
    assert.deepEqual(snapshot(),protectedBefore);
  }
  assert.deepEqual(read(),before);
});

test('default compiler CLI validates the retained source and artifact without compilation or writes',()=>{
  const before=read();
  assert.match(execFileSync(process.execPath,[compiler],{encoding:'utf8'}),/no compilation or artifact writes/);
  assert.deepEqual(read(),before);
});

test('candidate compilation rejects repository and existing output before overwriting any artifact',t=>{
  const before=read();
  const inside=spawnSync(process.execPath,[compiler,'--candidate-output',path.join(root,'runtime/nusd/artifacts')],{encoding:'utf8'});
  assert.notEqual(inside.status,0);
  assert.match(inside.stderr,/CANDIDATE_OUTPUT_MUST_BE_OUTSIDE_REPOSITORY/);
  const output=fs.mkdtempSync(path.resolve(root,'../compiler-output-guard-'));
  t.after(()=>fs.rmSync(output,{recursive:true,force:true}));
  const existing=path.join(output,'NuminaUSD.json');fs.writeFileSync(existing,'preserved candidate');
  const occupied=spawnSync(process.execPath,[compiler,'--candidate-output',output],{encoding:'utf8'});
  assert.notEqual(occupied.status,0);
  assert.match(occupied.stderr,/CANDIDATE_OUTPUT_NOT_EMPTY/);
  assert.equal(fs.readFileSync(existing,'utf8'),'preserved candidate');
  assert.deepEqual(read(),before);
});
