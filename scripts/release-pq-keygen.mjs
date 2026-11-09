// Generates post-quantum signing keypairs on the key holder's machine. Private keys are written
// only into the directory given with --out (created with owner-only permissions where the OS
// supports it; files are never overwritten). Only public keys are printed; with --pub-out they
// are also written there (for example release-evidence/pubkeys).
//   node scripts/release-pq-keygen.mjs --out <private-dir> [--pub-out <dir>] [--all | --schemes ML-DSA-65,FN-DSA-512] [--include-ed25519] [--probe]
// --include-ed25519 also creates SKOTT34-Ed25519 (only if no Ed25519 key exists yet; never overwrites).
// Default set: ML-DSA-65, ML-DSA-87, SLH-DSA-SHA2-128s, SLH-DSA-SHAKE-128s, FN-DSA-512, FN-DSA-1024.
import {writeFileSync,mkdirSync,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DEFAULT_PQ_SCHEMES,probeSchemes,generateKeyPair,privateKeyFileName,publicKeyFileName,keyidFor,parseArgs} from './release-lib.mjs';

export async function pqKeygen({out,pubOut,all=false,schemes,includeEd25519=false,log=console.log}){
  const probe=await probeSchemes();
  const wanted=[...(schemes?schemes.map(s=>s.trim()).filter(Boolean):all?probe.filter(s=>s.scheme!=='Ed25519').map(s=>s.scheme):DEFAULT_PQ_SCHEMES)];
  if(includeEd25519&&!wanted.includes('Ed25519'))wanted.unshift('Ed25519');
  if(!out)throw Error('--out <private-key-directory> is required');
  mkdirSync(out,{recursive:true,mode:0o700});if(pubOut)mkdirSync(pubOut,{recursive:true});
  const made=[],skipped=[];
  for(const name of wanted){
    const s=probe.find(p=>p.scheme.toLowerCase()===name.toLowerCase());
    if(!s){skipped.push({scheme:name,reason:'unknown scheme'});continue;}
    if(!s.supported){skipped.push({scheme:s.scheme,reason:s.reason});continue;}
    const priv=path.join(out,privateKeyFileName(s));if(existsSync(priv))throw Error('Refusing to overwrite existing key '+priv);
    const pair=await generateKeyPair(s);
    writeFileSync(priv,pair.privateFile,{mode:0o600,flag:'wx'});
    if(pubOut)writeFileSync(path.join(pubOut,publicKeyFileName(s)),pair.publicFile);
    log('# Public key '+keyidFor(s.scheme)+(s.preStandard?' (pre-standard)':''));log(pair.publicFile.trimEnd());
    made.push({keyid:keyidFor(s.scheme),privateKeyFile:priv,publicKeyFile:publicKeyFileName(s)});
  }
  return {made,skipped};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=parseArgs(process.argv.slice(2));
  if(args.probe){probeSchemes().then(p=>{for(const s of p)console.log((s.supported?'supported  ':'unsupported')+' '+s.scheme+' ['+s.standard+']'+(s.reason?' - '+s.reason:''));});}
  else pqKeygen({out:args.out?.[0],pubOut:args['pub-out']?.[0],all:!!args.all,schemes:args.schemes?.[0]?.split(','),includeEd25519:!!args['include-ed25519']})
    .then(r=>console.log(JSON.stringify({generated:r.made.map(m=>({keyid:m.keyid,publicKeyFile:m.publicKeyFile})),skipped:r.skipped},null,2)))
    .catch(error=>{console.error('release-pq-keygen: '+error.message);process.exit(1);});
}
