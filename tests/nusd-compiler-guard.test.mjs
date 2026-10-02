import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const compiler=path.join(root,'runtime/nusd/development/compile.mjs');
const retained=['contracts/NuminaUSD.sol','artifacts/NuminaUSD.json','deployment-receipt.json'].map(file=>path.join(root,'runtime/nusd',file));
const read=()=>retained.map(file=>fs.readFileSync(file));

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
