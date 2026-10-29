import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';

export const NUSD_VERIFICATION_POLICY=Object.freeze({
  repository:'skott34-dot/numina-production',
  sourceDigest:'2b0be57996c70e8fda49199d1d649fe3faf0e0d3',
  sourceRef:'refs/heads/main',
  signerWorkflow:'skott34-dot/numina-builder/.github/workflows/numina-nusd-runtime-builder.yml',
  signerDigest:'cda9bf7702d909ed1d8e16c338a91e283c1bce53',
  oidcIssuer:'https://token.actions.githubusercontent.com',
  predicateType:'https://slsa.dev/provenance/v1',
  runUrl:'https://github.com/skott34-dot/numina-production/actions/runs/34725802271/attempts/1',
  selfHostedRunnersDenied:true
});
export const NUSD_SUBJECTS=Object.freeze([
  'numina-nusd-linux-runtime-source.tar.gz',
  'numina-nusd-linux-runtime-image.docker.tar.gz',
  'numina-nusd-runtime-inventory.json'
]);
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=filename=>JSON.parse(fs.readFileSync(filename,'utf8'));
const inside=(parent,child)=>{const rel=path.relative(parent,child);return !rel||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel));};
function regularFile(filename){const resolved=fs.realpathSync(filename);if(!fs.statSync(resolved).isFile())throw Error('Expected a regular file: '+filename);return resolved;}
function checkCompletion(record){
  const p=NUSD_VERIFICATION_POLICY;
  if(record.schema!=='numina.hosted-runtime-completion.v1'||record.source?.repository!==p.repository||record.source?.commit!==p.sourceDigest||record.source?.ref!==p.sourceRef||record.source?.directory!=='runtime/nusd'||record.builder?.workflow!==p.signerWorkflow||record.builder?.commit!==p.signerDigest||record.run?.url!==p.runUrl)throw Error('Historical completion source, builder or run differs from pinned policy');
  if(!Array.isArray(record.subjects)||record.subjects.length!==3||new Set(record.subjects.map(s=>s.file)).size!==3||NUSD_SUBJECTS.some(file=>!record.subjects.some(s=>s.file===file)))throw Error('Historical completion must contain exactly the three pinned subject names');
  for(const s of record.subjects)if(!/^[a-f0-9]{64}$/.test(s.sha256)||!Number.isSafeInteger(s.bytes)||s.bytes<0)throw Error('Invalid historical subject digest or size: '+s.file);
}

export function verificationArguments(subject,bundle){
  const p=NUSD_VERIFICATION_POLICY;
  return ['attestation','verify',subject,'--hostname','github.com','--bundle',bundle,'--repo',p.repository,'--signer-workflow',p.signerWorkflow,'--signer-digest',p.signerDigest,'--source-digest',p.sourceDigest,'--source-ref',p.sourceRef,'--cert-oidc-issuer',p.oidcIssuer,'--predicate-type',p.predicateType,'--deny-self-hosted-runners','--format','json'];
}

// GH performs certificate-chain, transparency-log and signature verification. These
// additional comparisons reject successful commands with unusable or wrong output.
export function validateVerificationOutput(stdout,{file,sha256:actualDigest}){
  const results=JSON.parse(stdout);
  if(!Array.isArray(results)||results.length===0)throw Error('GH returned no verification results');
  const p=NUSD_VERIFICATION_POLICY,sourceUri='https://github.com/'+p.repository,signerUri='https://github.com/'+p.signerWorkflow+'@'+p.signerDigest;
  const matches=results.filter(result=>{
    const v=result?.verificationResult,c=v?.signature?.certificate,s=v?.statement;
    const envelope=result?.attestation?.bundle?.dsseEnvelope;
    let signedStatement;
    try{signedStatement=JSON.parse(Buffer.from(envelope.payload,'base64').toString('utf8'));}catch{return false;}
    if(envelope.payloadType!=='application/vnd.in-toto+json'||!envelope.signatures?.some(signature=>typeof signature.sig==='string'&&signature.sig.length>0))return false;
    if(!isDeepStrictEqual(signedStatement,s))return false;
    const d=s?.predicate?.buildDefinition,r=s?.predicate?.runDetails;
    return c?.sourceRepositoryURI===sourceUri&&c.sourceRepositoryDigest===p.sourceDigest&&c.sourceRepositoryRef===p.sourceRef&&c.buildSignerURI===signerUri&&c.buildSignerDigest===p.signerDigest&&c.issuer===p.oidcIssuer&&c.runnerEnvironment==='github-hosted'&&c.runInvocationURI===p.runUrl&&
      s?._type==='https://in-toto.io/Statement/v1'&&s.predicateType===p.predicateType&&
      s.subject?.some(subject=>subject.name===file&&subject.digest?.sha256===actualDigest)&&
      d?.externalParameters?.workflow?.repository===sourceUri&&d.externalParameters.workflow.ref===p.sourceRef&&
      d.resolvedDependencies?.some(dep=>dep.uri==='git+'+sourceUri+'@'+p.sourceRef&&dep.digest?.gitCommit===p.sourceDigest)&&
      r?.builder?.id===signerUri&&r.metadata?.invocationId===p.runUrl;
  });
  if(!matches.length)throw Error('GH output lacks a matching verified subject, source, signer or run');
  return {matchingResults:matches.length,sourceDigest:p.sourceDigest,signerDigest:p.signerDigest};
}

export function verifyCompletionRecord({completion,bundle,gh,outputDir},run=spawnSync){
  const completionPath=regularFile(completion),bundlePath=regularFile(bundle),ghPath=regularFile(gh);
  const inputDir=path.dirname(completionPath),record=json(completionPath);
  checkCompletion(record);
  const requestedOutput=path.resolve(outputDir);
  const outputPath=path.join(fs.realpathSync(path.dirname(requestedOutput)),path.basename(requestedOutput));
  if(inside(inputDir,outputPath)||inside(outputPath,completionPath)||inside(outputPath,bundlePath)||inside(outputPath,ghPath))throw Error('Output directory must be separate from historical inputs');
  // Exclusive creation also prevents overwriting a previous verification record.
  fs.mkdirSync(outputPath);
  const startedAt=new Date().toISOString();
  const report={schema:'numina.completion-verification.v1',startedAt,completedAt:null,status:'failed',
    historicalCompletion:{path:completionPath,sha256:sha256(fs.readFileSync(completionPath)),recordedAt:record.recordedAt},
    bundle:{path:bundlePath,sha256:sha256(fs.readFileSync(bundlePath))},
    executable:{path:ghPath,sha256:sha256(fs.readFileSync(ghPath))},
    signaturePolicy:NUSD_VERIFICATION_POLICY,subjects:[],
    scope:'Unsigned observation of separate GH verification commands for historical NUSD build artifacts. No image was started, deployed or submitted to any provider; no NVIDIA access, licensing, reserves, mint, transfer or bank evidence is established.'};
  for(const filename of NUSD_SUBJECTS){
    const expected=record.subjects.find(s=>s.file===filename),subject={file:filename,expectedSha256:expected.sha256,expectedBytes:expected.bytes,sha256:null,bytes:null,hashMatches:false,commandExecuted:false,exitCode:null,signal:null,passed:false,errors:[]};
    let subjectPath;
    try{
      subjectPath=regularFile(path.join(inputDir,filename));
      if(path.dirname(subjectPath)!==inputDir)throw Error('Subject resolves outside the historical input directory');
      const bytes=fs.readFileSync(subjectPath);subject.bytes=bytes.length;subject.sha256=sha256(bytes);
      subject.hashMatches=subject.sha256===expected.sha256&&subject.bytes===expected.bytes;
      if(!subject.hashMatches)subject.errors.push('Subject bytes differ from historical completion record');
    }catch(error){subject.errors.push(error.message);}
    let stdout=Buffer.alloc(0),stderr=Buffer.alloc(0);
    if(subjectPath&&subject.sha256){
      const argv=verificationArguments(subjectPath,bundlePath);subject.command={executable:ghPath,argv};
      subject.startedAt=new Date().toISOString();subject.commandExecuted=true;
      try{
        const result=run(ghPath,argv,{shell:false,windowsHide:true,timeout:60000,maxBuffer:16*1024*1024,encoding:null});
        stdout=Buffer.from(result.stdout??'');stderr=Buffer.from(result.stderr??'');
        subject.exitCode=Number.isInteger(result.status)?result.status:null;subject.signal=result.signal??null;
        if(result.error)subject.errors.push(result.error.message);
        if(subject.signal)subject.errors.push('GH verification was interrupted by signal '+subject.signal);
        if(subject.exitCode!==0)subject.errors.push('GH verification did not exit successfully');
        else subject.verifiedIdentity=validateVerificationOutput(stdout.toString('utf8'),subject);
      }catch(error){subject.errors.push(error.message);}
      subject.completedAt=new Date().toISOString();
      try{if(sha256(fs.readFileSync(subjectPath))!==subject.sha256)subject.errors.push('Subject changed during verification');}catch(error){subject.errors.push(error.message);}
    }
    for(const [name,bytes] of [['stdout',stdout],['stderr',stderr]]){
      const logName=filename+'.gh.'+name;fs.writeFileSync(path.join(outputPath,logName),bytes,{flag:'wx'});
      subject[name]={file:logName,bytes:bytes.length,sha256:sha256(bytes)};
    }
    subject.passed=subject.commandExecuted&&subject.exitCode===0&&subject.hashMatches&&subject.errors.length===0;
    report.subjects.push(subject);
  }
  report.inputFilesUnchanged=[['historicalCompletion',completionPath],['bundle',bundlePath],['executable',ghPath]].every(([key,filename])=>{
    try{return sha256(fs.readFileSync(filename))===report[key].sha256;}catch{return false;}
  });
  report.completedAt=new Date().toISOString();report.commandsExecuted=report.subjects.filter(s=>s.commandExecuted).length;
  report.commandsPassed=report.subjects.filter(s=>s.passed).length;
  report.status=report.inputFilesUnchanged&&report.commandsPassed===3?'passed':'failed';
  fs.writeFileSync(path.join(outputPath,'completion-record.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  return report;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{
    const names={'--completion':'completion','--bundle':'bundle','--gh':'gh','--output-dir':'outputDir'},options={};
    for(let i=2;i<process.argv.length;i+=2){const key=names[process.argv[i]],value=process.argv[i+1];if(!key||!value||value.startsWith('--')||options[key])throw Error('Usage: node scripts/verify-completion-record.mjs --completion FILE --bundle FILE --gh EXECUTABLE --output-dir NEW_DIRECTORY');options[key]=value;}
    if(Object.keys(options).length!==4)throw Error('Explicit --completion, --bundle, --gh and --output-dir are required');
    const report=verifyCompletionRecord(options);
    console.log(JSON.stringify({status:report.status,commandsExecuted:report.commandsExecuted,commandsPassed:report.commandsPassed,record:path.resolve(options.outputDir,'completion-record.json')}));
    if(report.status!=='passed')process.exitCode=1;
  }catch(error){console.error(error.message);process.exitCode=1;}
}
