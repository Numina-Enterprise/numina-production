// Verifies the release: recomputes every dist/client and dist/server digest against the signed
// statement, checks the source tree digest, and verifies every DSSE signature whose public key is
// committed under release-evidence/pubkeys/. Exit 0 only if everything matches:
//  - Ed25519 signature and public key present and valid (required);
//  - every present signature with a committed public key verifies (ML-DSA, SLH-DSA, FN-DSA);
//  - every committed public key has a signature.
//   node scripts/release-verify.mjs [--envelope <path>] [--statement <path>] [--pubkeys <dir>] [--digests-only | --signatures-only]
// --signatures-only checks the envelope signatures and committed public keys without a dist build
// (used by the Windows signing kit); CI runs the full check.
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT,PAYLOAD_TYPE,STATEMENT_TYPE,PUBKEY_DIR,pae,sha256,collectSubjects,sourceTree,releasePaths,schemeFromKeyid,publicKeyFileName,keyidFor,verifySignature,parseArgs} from './release-lib.mjs';

export async function verifyRelease({root=ROOT,envelopePath,statementPath,pubkeyDir,digestsOnly=false,signaturesOnly=false}={}){
  const report={ok:false,errors:[],digests:null,sourceTree:null,signatures:[]};
  const fail=m=>{report.errors.push(m);return report;};
  const version=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).version,paths=releasePaths(version);
  let payload;
  if(digestsOnly){const f=path.resolve(root,statementPath||paths.statement);if(!existsSync(f))return fail('Statement missing: '+path.relative(root,f));payload=readFileSync(f);}
  else{
    const envFile=path.resolve(root,envelopePath||paths.envelope);
    if(!existsSync(envFile))return fail('DSSE envelope missing: '+path.relative(root,envFile));
    let envelope;try{envelope=JSON.parse(readFileSync(envFile,'utf8'));}catch{return fail('DSSE envelope is not valid JSON');}
    if(envelope.payloadType!==PAYLOAD_TYPE)return fail('Unexpected payloadType');
    if(!Array.isArray(envelope.signatures)||!envelope.signatures.length)return fail('Envelope has no signatures');
    payload=Buffer.from(envelope.payload||'','base64');
    const committed=path.resolve(root,statementPath||paths.statement);
    if(existsSync(committed)&&!readFileSync(committed).equals(payload))report.errors.push('Committed statement differs from the signed payload');
    const message=pae(PAYLOAD_TYPE,payload),dir=path.resolve(root,pubkeyDir||PUBKEY_DIR);
    const pubFiles=existsSync(dir)?readdirSync(dir).filter(n=>/^SKOTT34-.+\.pub\.(pem|json)$/.test(n)):[];
    const signedKeyids=new Set();
    for(const sig of envelope.signatures){
      const s=schemeFromKeyid(sig.keyid),entry={keyid:sig.keyid,scheme:s?.scheme??null,status:'fail'};report.signatures.push(entry);
      if(!s){entry.reason='Unknown keyid';report.errors.push('Unknown signature keyid '+sig.keyid);continue;}
      if(signedKeyids.has(sig.keyid)){entry.reason='Duplicate keyid';report.errors.push('Duplicate signature '+sig.keyid);continue;}
      signedKeyids.add(sig.keyid);
      const pub=path.join(dir,publicKeyFileName(s));
      if(!existsSync(pub)){entry.status=s.required?'fail':'skipped';entry.reason='No committed public key';if(s.required)report.errors.push('Ed25519 public key missing: '+path.relative(root,pub));continue;}
      try{if(await verifySignature(s,readFileSync(pub,'utf8'),message,Buffer.from(sig.sig,'base64'))){entry.status='pass';}else{entry.reason='Signature does not verify';report.errors.push(sig.keyid+' signature does not verify');}}
      catch(error){entry.reason=error.message;report.errors.push(sig.keyid+': '+error.message);}
      if(s.preStandard)entry.note='pre-standard scheme (FIPS 206 not final); optional';
    }
    if(!signedKeyids.has(keyidFor('Ed25519')))report.errors.push('Required Ed25519 signature (SKOTT34-Ed25519) is missing');
    for(const n of pubFiles){const keyid=n.replace(/\.pub\.(pem|json)$/,'');if(!signedKeyids.has(keyid))report.errors.push('Committed public key '+n+' has no signature in the envelope');}
  }
  if(signaturesOnly){report.statementSha256=sha256(payload);report.ok=report.errors.length===0;return report;}
  let statement;try{statement=JSON.parse(payload);}catch{return fail('Statement payload is not JSON');}
  if(statement._type!==STATEMENT_TYPE||!Array.isArray(statement.subject))return fail('Not an in-toto Statement v1');
  const actual=collectSubjects(root),expected=new Map(statement.subject.map(s=>[s.name,s.digest?.sha256]));
  const differ=[],missing=[],extra=[];
  for(const s of actual){if(!expected.has(s.name))extra.push(s.name);else if(expected.get(s.name)!==s.digest.sha256)differ.push(s.name);}
  const names=new Set(actual.map(s=>s.name));for(const n of expected.keys())if(!names.has(n))missing.push(n);
  report.digests={subjects:actual.length,differ,missing,extra};
  if(differ.length||missing.length||extra.length)report.errors.push('dist digests do not match the statement ('+differ.length+' differ, '+missing.length+' missing, '+extra.length+' extra)');
  try{const tree=sourceTree(root,version);report.sourceTree={expected:statement.predicate?.sourceTree?.sha256,actual:tree.sha256};if(tree.sha256!==statement.predicate?.sourceTree?.sha256)report.errors.push('Source tree digest does not match the statement');}
  catch(error){report.errors.push('Source tree digest unavailable: '+error.message);}
  report.statementSha256=sha256(payload);report.ok=report.errors.length===0;return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=parseArgs(process.argv.slice(2));
  verifyRelease({envelopePath:args.envelope?.[0],statementPath:args.statement?.[0],pubkeyDir:args.pubkeys?.[0],digestsOnly:!!args['digests-only'],signaturesOnly:!!args['signatures-only']}).then(r=>{
    for(const s of r.signatures)console.log((s.status==='pass'?'PASS ':s.status==='skipped'?'SKIP ':'FAIL ')+s.keyid+(s.reason?' - '+s.reason:'')+(s.note?' ('+s.note+')':''));
    console.log(JSON.stringify({ok:r.ok,statementSha256:r.statementSha256,digests:r.digests&&{subjects:r.digests.subjects,differ:r.digests.differ.slice(0,50),missing:r.digests.missing.slice(0,50),extra:r.digests.extra.slice(0,50)},sourceTree:r.sourceTree,errors:r.errors},null,2));
    process.exit(r.ok?0:1);
  }).catch(error=>{console.error('release-verify: '+error.message);process.exit(1);});
}
