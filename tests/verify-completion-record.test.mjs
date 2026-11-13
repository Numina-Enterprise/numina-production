import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {verifyCompletionRecord,validateVerificationOutput,NUSD_VERIFICATION_POLICY as policy,NUSD_SUBJECTS} from '../scripts/verify-completion-record.mjs';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(t){
  const dir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'numina-completion-test-'));
  t.after(()=>{assert.ok(path.isAbsolute(dir)&&path.dirname(dir)===fs.realpathSync(os.tmpdir())&&path.basename(dir).startsWith('numina-completion-test-'));fs.rmSync(dir,{recursive:true,force:true});});
  const inputs=path.join(dir,'historical');fs.mkdirSync(inputs);
  const record={schema:'numina.hosted-runtime-completion.v1',recordedAt:'2026-09-12T23:40:28.662Z',
    source:{repository:policy.repository,commit:policy.sourceDigest,ref:policy.sourceRef,directory:'runtime/nusd'},
    builder:{workflow:policy.signerWorkflow,commit:policy.signerDigest},run:{url:policy.runUrl},
    subjects:NUSD_SUBJECTS.map((file,index)=>{
      const bytes=Buffer.from('Test-only historical subject '+index);fs.writeFileSync(path.join(inputs,file),bytes);
      return {file,sha256:digest(bytes),bytes:bytes.length};
    })};
  const options={completion:path.join(inputs,'completion-record.json'),bundle:path.join(inputs,'provenance.jsonl'),gh:path.join(dir,'test-gh-executable'),outputDir:path.join(dir,'fresh')};
  fs.writeFileSync(options.completion,JSON.stringify(record));fs.writeFileSync(options.bundle,'test-only bundle');fs.writeFileSync(options.gh,'test-only executable');
  return {options,record,inputs};
}
function output(subject){
  const sourceUri='https://github.com/'+policy.repository,signerUri='https://github.com/'+policy.signerWorkflow+'@'+policy.signerDigest;
  const result={verificationResult:{signature:{certificate:{sourceRepositoryURI:sourceUri,sourceRepositoryDigest:policy.sourceDigest,sourceRepositoryRef:policy.sourceRef,buildSignerURI:signerUri,buildSignerDigest:policy.signerDigest,issuer:policy.oidcIssuer,runnerEnvironment:'github-hosted',runInvocationURI:policy.runUrl}},
    statement:{_type:'https://in-toto.io/Statement/v1',subject:[{name:subject.file,digest:{sha256:subject.sha256}}],predicateType:policy.predicateType,predicate:{
      buildDefinition:{externalParameters:{workflow:{repository:sourceUri,ref:policy.sourceRef}},resolvedDependencies:[{uri:'git+'+sourceUri+'@'+policy.sourceRef,digest:{gitCommit:policy.sourceDigest}}]},
      runDetails:{builder:{id:signerUri},metadata:{invocationId:policy.runUrl}}
    }}}};
  result.attestation={bundle:{dsseEnvelope:{payloadType:'application/vnd.in-toto+json',payload:Buffer.from(JSON.stringify(result.verificationResult.statement)).toString('base64'),signatures:[{sig:'test-only-placeholder'}]}}};
  return [result];
}
function successful(argv){const bytes=fs.readFileSync(argv[2]);return {status:0,stdout:JSON.stringify(output({file:path.basename(argv[2]),sha256:digest(bytes)})),stderr:''};}

test('records three separate pinned GH invocations and exact stdout/stderr hashes without changing historical bytes',t=>{
  const {options,record}=fixture(t),before=fs.readFileSync(options.completion),calls=[];
  const result=verifyCompletionRecord(options,(exe,argv,spawnOptions)=>{
    calls.push(argv);assert.equal(exe,options.gh);assert.equal(spawnOptions.shell,false);assert.equal(spawnOptions.windowsHide,true);
    for(const [flag,value] of [['--source-digest',policy.sourceDigest],['--source-ref',policy.sourceRef],['--signer-digest',policy.signerDigest],['--signer-workflow',policy.signerWorkflow],['--cert-oidc-issuer',policy.oidcIssuer],['--predicate-type',policy.predicateType]])assert.equal(argv[argv.indexOf(flag)+1],value);
    assert.ok(argv.includes('--deny-self-hosted-runners'));return {...successful(argv),stderr:'test-only diagnostic\n'};
  });
  assert.equal(result.status,'passed');assert.equal(result.commandsPassed,3);assert.equal(calls.length,3);
  assert.deepEqual(calls.map(argv=>path.basename(argv[2])),NUSD_SUBJECTS);
  for(const subject of result.subjects){
    assert.equal(subject.exitCode,0);assert.equal(subject.sha256,record.subjects.find(s=>s.file===subject.file).sha256);
    for(const stream of ['stdout','stderr'])assert.equal(digest(fs.readFileSync(path.join(options.outputDir,subject[stream].file))),subject[stream].sha256);
  }
  assert.deepEqual(fs.readFileSync(options.completion),before);
  assert.equal(JSON.parse(fs.readFileSync(path.join(options.outputDir,'completion-record.json'))).commandsExecuted,3);
  assert.match(result.scope,/No image was started/);assert.match(result.scope,/no NVIDIA access/);
});

test('continues every subject after a GH failure and rejects a zero exit with malformed JSON',t=>{
  const {options}=fixture(t);let calls=0;
  const result=verifyCompletionRecord(options,(_exe,argv)=>{
    calls++;if(calls===1)return {status:1,stdout:'',stderr:'verification failed'};
    if(calls===2)return {status:0,stdout:'not JSON',stderr:''};return successful(argv);
  });
  assert.equal(calls,3);assert.equal(result.status,'failed');assert.equal(result.commandsPassed,1);
  assert.deepEqual(result.subjects.map(s=>s.exitCode),[1,0,0]);
  assert.deepEqual(result.subjects.map(s=>s.passed),[false,false,true]);
});

test('rejects a wrong matching subject, source, signer, issuer, runner or run in otherwise successful output',()=>{
  const subject={file:NUSD_SUBJECTS[0],sha256:'a'.repeat(64)};
  const mutations=[
    r=>r[0].verificationResult.statement.subject[0].digest.sha256='b'.repeat(64),
    r=>r[0].verificationResult.statement.subject[0].name=NUSD_SUBJECTS[1],
    r=>r[0].verificationResult.signature.certificate.sourceRepositoryDigest='b'.repeat(40),
    r=>r[0].verificationResult.statement.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit='b'.repeat(40),
    r=>r[0].verificationResult.signature.certificate.buildSignerDigest='b'.repeat(40),
    r=>r[0].verificationResult.signature.certificate.issuer='https://wrong.invalid',
    r=>r[0].verificationResult.signature.certificate.runnerEnvironment='self-hosted',
    r=>r[0].verificationResult.statement.predicate.runDetails.metadata.invocationId='https://wrong.invalid',
    r=>r[0].attestation.bundle.dsseEnvelope.payload=Buffer.from('{}').toString('base64'),
    r=>r[0].attestation.bundle.dsseEnvelope.signatures=[]
  ];
  for(const mutate of mutations){const value=output(subject);mutate(value);assert.throws(()=>validateVerificationOutput(JSON.stringify(value),subject),/lacks a matching/);}
  for(const value of ['[]','{}','null'])assert.throws(()=>validateVerificationOutput(value,subject),/no verification results/);
});

test('wrong historical source fails before GH; an existing output directory is never overwritten',t=>{
  const {options,record}=fixture(t);let calls=0;
  record.source.commit='b'.repeat(40);fs.writeFileSync(options.completion,JSON.stringify(record));
  assert.throws(()=>verifyCompletionRecord(options,()=>{calls++;}),/differs from pinned policy/);assert.equal(calls,0);assert.equal(fs.existsSync(options.outputDir),false);
  record.source.commit=policy.sourceDigest;fs.writeFileSync(options.completion,JSON.stringify(record));
  fs.mkdirSync(options.outputDir);fs.writeFileSync(path.join(options.outputDir,'completion-record.json'),'preserve');
  assert.throws(()=>verifyCompletionRecord(options,()=>{calls++;}),/EEXIST/);assert.equal(calls,0);
  assert.equal(fs.readFileSync(path.join(options.outputDir,'completion-record.json'),'utf8'),'preserve');
  assert.throws(()=>verifyCompletionRecord({...options,outputDir:path.join(path.dirname(options.completion),'fresh')},()=>{calls++;}),/separate from historical inputs/);
});

test('records missing, changed and intact subjects independently',t=>{
  const {options,inputs}=fixture(t);let calls=0;
  fs.unlinkSync(path.join(inputs,NUSD_SUBJECTS[0]));fs.appendFileSync(path.join(inputs,NUSD_SUBJECTS[1]),'tampered');
  const result=verifyCompletionRecord(options,(_exe,argv)=>{calls++;return successful(argv);});
  assert.equal(calls,2);assert.equal(result.subjects.length,3);assert.equal(result.status,'failed');
  assert.deepEqual(result.subjects.map(s=>s.passed),[false,false,true]);
  assert.equal(result.subjects[0].exitCode,null);assert.equal(result.subjects[0].commandExecuted,false);
  assert.match(result.subjects[1].errors.join(' '),/bytes differ/);
});

test('detects bytes changed while GH verifies and records subprocess errors without abandoning later subjects',t=>{
  const {options}=fixture(t);let calls=0;
  const result=verifyCompletionRecord(options,(_exe,argv)=>{
    calls++;if(calls===2)return {status:null,error:new Error('spawn failed'),stdout:'',stderr:''};
    const success=successful(argv);if(calls===1)fs.appendFileSync(argv[2],'concurrent mutation');return success;
  });
  assert.equal(calls,3);assert.equal(result.status,'failed');assert.equal(result.commandsPassed,1);
  assert.match(result.subjects[0].errors.join(' '),/changed during verification/);
  assert.match(result.subjects[1].errors.join(' '),/spawn failed/);
});

test('never accepts a zero exit accompanied by a subprocess error or signal',t=>{
  const {options}=fixture(t);let calls=0;
  const result=verifyCompletionRecord(options,(_exe,argv)=>{
    calls++;const success=successful(argv);
    if(calls===1)return {...success,error:new Error('subprocess output limit exceeded')};
    if(calls===2)return {...success,signal:'SIGTERM'};return success;
  });
  assert.equal(calls,3);assert.equal(result.status,'failed');assert.equal(result.commandsPassed,1);
  assert.deepEqual(result.subjects.map(s=>s.exitCode),[0,0,0]);
  assert.deepEqual(result.subjects.map(s=>s.passed),[false,false,true]);
  assert.match(result.subjects[0].errors.join(' '),/output limit exceeded/);
  assert.match(result.subjects[1].errors.join(' '),/interrupted by signal SIGTERM/);
});
