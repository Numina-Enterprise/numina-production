// Signs the release statement into a DSSE envelope (one signature per key; Ed25519 required).
// Run on the key holder's own machine. Private keys are read only from the paths given and are
// never printed, copied or written. Only public keys are printed (and, with --write-pubkeys,
// written to release-evidence/pubkeys/).
//   node scripts/release-sign.mjs --key <ed25519.pem> --keyid SKOTT34-Ed25519 [--key <pq.pem> --keyid SKOTT34-ML-DSA-65 ...]
//   node scripts/release-sign.mjs --key <ed25519.pem> --key-dir <dir with SKOTT34-*.key.pem|json> [--write-pubkeys]
// Optional: --statement <path> --out <path>; NUMINA_SIGNING_KEY_PASSPHRASE for encrypted PEM.
import {readFileSync,writeFileSync,readdirSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT,PAYLOAD_TYPE,PUBKEY_DIR,pae,sha256,loadPrivateKey,keyidFor,publicKeyFileName,releasePaths,parseArgs} from './release-lib.mjs';

export async function signRelease({root=ROOT,keys=[],keyDir,statementPath,outPath,writePubkeys=false,log=console.log}){
  const version=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).version,paths=releasePaths(version);
  const statementFile=path.resolve(root,statementPath||paths.statement),payload=readFileSync(statementFile);
  JSON.parse(payload);
  const entries=[...keys];
  if(keyDir)for(const n of readdirSync(keyDir).sort())if(/^SKOTT34-.+\.key\.(pem|json)$/.test(n))entries.push({file:path.join(keyDir,n)});
  const message=pae(PAYLOAD_TYPE,payload),signatures=[],publicKeys=[],seen=new Set();
  for(const {file,keyid} of entries){
    const loaded=await loadPrivateKey(file),expected=keyidFor(loaded.scheme.scheme);
    if(keyid&&keyid!==expected)throw Error('Key id '+keyid+' does not match the key type in '+path.basename(file)+' (expected '+expected+')');
    if(seen.has(expected))continue;seen.add(expected);
    signatures.push({keyid:expected,sig:loaded.signer(message).toString('base64')});
    publicKeys.push({keyid:expected,file:publicKeyFileName(loaded.scheme),text:loaded.publicKey});
  }
  if(!seen.has(keyidFor('Ed25519')))throw Error('An Ed25519 key (SKOTT34-Ed25519) is required');
  const envelope={payloadType:PAYLOAD_TYPE,payload:payload.toString('base64'),signatures};
  const out=path.resolve(root,outPath||paths.envelope);mkdirSync(path.dirname(out),{recursive:true});
  writeFileSync(out,JSON.stringify(envelope,null,2)+'\n');
  for(const key of publicKeys){
    log('# Public key '+key.keyid+' -> save as '+PUBKEY_DIR+'/'+key.file);log(key.text.trimEnd());
    if(writePubkeys){mkdirSync(path.join(root,PUBKEY_DIR),{recursive:true});writeFileSync(path.join(root,PUBKEY_DIR,key.file),key.text);}
  }
  return {envelope:out,statementSha256:sha256(payload),keyids:signatures.map(s=>s.keyid)};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const argv=process.argv.slice(2),keys=[];
  for(let i=0;i<argv.length;i++){if(argv[i]==='--key')keys.push({file:argv[++i]});else if(argv[i]==='--keyid'){if(!keys.length)throw Error('--keyid must follow --key');keys[keys.length-1].keyid=argv[++i];}}
  const args=parseArgs(argv.filter((a,i)=>!['--key','--keyid'].includes(a)&&!['--key','--keyid'].includes(argv[i-1])));
  signRelease({keys,keyDir:args['key-dir']?.[0],statementPath:args.statement?.[0],outPath:args.out?.[0],writePubkeys:!!args['write-pubkeys']})
    .then(r=>console.log(JSON.stringify({envelope:path.relative(ROOT,r.envelope),statementSha256:r.statementSha256,signatures:r.keyids},null,2)))
    .catch(error=>{console.error('release-sign: '+error.message);process.exit(1);});
}
