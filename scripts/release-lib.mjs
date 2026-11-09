// Release attestation helpers: in-toto Statement v1 + DSSE envelopes with hybrid signatures.
// Node built-ins only for Ed25519, ML-DSA (FIPS 204) and SLH-DSA (FIPS 205). FN-DSA/Falcon is
// pre-standard (FIPS 206 not final) and uses the pinned devDependency @noble/post-quantum,
// loaded lazily and only by these release scripts (never by the Worker bundle).
// Private keys are only ever read from paths the operator supplies; nothing here prints,
// copies or writes private key material.
import {createHash,createPrivateKey,createPublicKey,generateKeyPairSync,sign,verify} from 'node:crypto';
import {readFileSync,readdirSync,statSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const ROOT=fileURLToPath(new URL('../',import.meta.url));
export const KEY_OWNER='SKOTT34';
export const PAYLOAD_TYPE='application/vnd.in-toto+json';
export const STATEMENT_TYPE='https://in-toto.io/Statement/v1';
export const PREDICATE_TYPE='https://numinalabs.xyz/attestations/release/v1';
export const PUBKEY_DIR='release-evidence/pubkeys';
export const SUBJECT_ROOTS=['dist/client','dist/server'];

// Every NIST-standardized signature scheme node:crypto may expose, plus pre-standard FN-DSA.
export const SCHEMES=Object.freeze([
  {scheme:'Ed25519',alg:'ed25519',family:'EdDSA',standard:'RFC 8032',impl:'node',required:true},
  ...['44','65','87'].map(n=>({scheme:'ML-DSA-'+n,alg:'ml-dsa-'+n,family:'ML-DSA',standard:'FIPS 204',impl:'node'})),
  ...['SHA2','SHAKE'].flatMap(h=>['128s','128f','192s','192f','256s','256f'].map(p=>({scheme:'SLH-DSA-'+h+'-'+p,alg:'slh-dsa-'+h.toLowerCase()+'-'+p,family:'SLH-DSA',standard:'FIPS 205',impl:'node'}))),
  {scheme:'FN-DSA-512',alg:'falcon512',family:'FN-DSA',standard:'pre-standard (FIPS 206 draft; Falcon round-3 spec as implemented by @noble/post-quantum)',impl:'noble',preStandard:true},
  {scheme:'FN-DSA-1024',alg:'falcon1024',family:'FN-DSA',standard:'pre-standard (FIPS 206 draft; Falcon round-3 spec as implemented by @noble/post-quantum)',impl:'noble',preStandard:true}
]);
export const DEFAULT_PQ_SCHEMES=['ML-DSA-65','ML-DSA-87','SLH-DSA-SHA2-128s','SLH-DSA-SHAKE-128s','FN-DSA-512','FN-DSA-1024'];
export const schemeByName=name=>SCHEMES.find(s=>s.scheme.toLowerCase()===String(name).toLowerCase());
export const schemeByAlg=alg=>SCHEMES.find(s=>s.alg===alg);
export const keyidFor=scheme=>KEY_OWNER+'-'+scheme;
export const schemeFromKeyid=keyid=>String(keyid).startsWith(KEY_OWNER+'-')?schemeByName(String(keyid).slice(KEY_OWNER.length+1)):undefined;

let falconModule;
export async function falcon(){
  if(!falconModule){try{falconModule=await import('@noble/post-quantum/falcon.js');}catch(error){throw Object.assign(Error('FN-DSA needs the pinned devDependency @noble/post-quantum (run npm ci): '+error.message),{code:'FALCON_UNAVAILABLE'});}}
  return falconModule;
}
export async function probeSchemes(){
  const results=[];
  for(const s of SCHEMES){
    try{
      if(s.impl==='node'){const k=generateKeyPairSync(s.alg);const sig=sign(null,Buffer.from('probe'),k.privateKey);if(!verify(null,Buffer.from('probe'),k.publicKey,sig))throw Error('self-test failed');}
      else{const f=(await falcon())[s.alg];const k=f.keygen();const sig=f.sign(Buffer.from('probe'),k.secretKey);if(!f.verify(sig,Buffer.from('probe'),k.publicKey))throw Error('self-test failed');}
      results.push({...s,supported:true});
    }catch(error){results.push({...s,supported:false,reason:error.code||error.message});}
  }
  return results;
}

export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
// DSSE v1 pre-authentication encoding: "DSSEv1" SP LEN(type) SP type SP LEN(body) SP body.
export function pae(payloadType,payload){
  const type=Buffer.from(payloadType,'utf8'),body=Buffer.isBuffer(payload)?payload:Buffer.from(payload);
  return Buffer.concat([Buffer.from('DSSEv1 '+type.length+' '),type,Buffer.from(' '+body.length+' '),body]);
}

export function collectSubjects(root=ROOT){
  const out=[];
  const walk=rel=>{for(const name of readdirSync(path.join(root,rel)).sort()){const r=rel+'/'+name,abs=path.join(root,r),st=statSync(abs);if(st.isDirectory())walk(r);else if(st.isFile())out.push({name:r,digest:{sha256:sha256(readFileSync(abs))}});}};
  for(const r of SUBJECT_ROOTS){if(!existsSync(path.join(root,r)))throw Error('Missing build output: '+r+' (run npm run build first)');walk(r);}
  return out.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
}

export function releasePaths(version){
  return {statement:'release-evidence/numina-'+version+'-release.statement.json',envelope:'release-evidence/numina-'+version+'-release.dsse.json'};
}
// Source tree digest: sha256 over `git ls-tree -r HEAD`, excluding the signing outputs
// (statement, envelope, public keys) so committing them does not change the value.
export function sourceTree(root=ROOT,version){
  const {statement,envelope}=releasePaths(version);
  const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:256*1024*1024});
  const lines=git(['ls-tree','-r','--full-tree','HEAD']).split('\n').filter(Boolean).filter(line=>{const p=line.slice(line.indexOf('\t')+1);return p!==statement&&p!==envelope&&!p.startsWith(PUBKEY_DIR+'/');});
  return {algorithm:'sha256(git ls-tree -r --full-tree HEAD, excluding statement, envelope and '+PUBKEY_DIR+'/)',sha256:sha256(lines.join('\n')+'\n'),gitCommit:git(['rev-parse','HEAD']).trim(),gitTree:git(['rev-parse','HEAD^{tree}']).trim()};
}

// --- keys -------------------------------------------------------------------------------
export async function loadPrivateKey(file,{passphrase=process.env.NUMINA_SIGNING_KEY_PASSPHRASE}={}){
  const text=readFileSync(file,'utf8');
  if(text.trimStart().startsWith('{')){
    const json=JSON.parse(text),s=schemeByName(json.scheme);
    if(!s||s.impl!=='noble'||typeof json.secretKey!=='string')throw Error('Unsupported JSON key file: '+path.basename(file));
    const f=(await falcon())[s.alg],secretKey=new Uint8Array(Buffer.from(json.secretKey,'base64'));
    const publicKey=new Uint8Array(Buffer.from(json.publicKey,'base64'));
    return {scheme:s,signer:msg=>Buffer.from(f.sign(msg,secretKey)),publicKey:falconPublicFile(s,publicKey)};
  }
  const key=createPrivateKey(passphrase?{key:text,passphrase}:text),s=schemeByAlg(key.asymmetricKeyType);
  if(!s)throw Error('Unsupported private key type '+key.asymmetricKeyType+' in '+path.basename(file));
  return {scheme:s,signer:msg=>sign(null,msg,key),publicKey:createPublicKey(key).export({type:'spki',format:'pem'})};
}
export const falconPublicFile=(s,publicKey)=>JSON.stringify({scheme:s.scheme,format:'raw-base64',implementation:'@noble/post-quantum',preStandard:true,publicKey:Buffer.from(publicKey).toString('base64')},null,2)+'\n';
export const publicKeyFileName=s=>keyidFor(s.scheme)+(s.impl==='noble'?'.pub.json':'.pub.pem');
export const privateKeyFileName=s=>keyidFor(s.scheme)+(s.impl==='noble'?'.key.json':'.key.pem');

export async function generateKeyPair(s){
  if(s.impl==='node'){const k=generateKeyPairSync(s.alg);return {privateFile:k.privateKey.export({type:'pkcs8',format:'pem'}),publicFile:k.publicKey.export({type:'spki',format:'pem'})};}
  const f=(await falcon())[s.alg],k=f.keygen();
  return {privateFile:JSON.stringify({scheme:s.scheme,format:'raw-base64',implementation:'@noble/post-quantum',preStandard:true,secretKey:Buffer.from(k.secretKey).toString('base64'),publicKey:Buffer.from(k.publicKey).toString('base64')})+'\n',publicFile:falconPublicFile(s,k.publicKey)};
}

export async function verifySignature(s,publicFileText,message,signature){
  if(s.impl==='node'){const key=createPublicKey(publicFileText);if(key.asymmetricKeyType!==s.alg)throw Error('Public key type '+key.asymmetricKeyType+' does not match '+s.scheme);return verify(null,message,key,signature);}
  const json=JSON.parse(publicFileText);if(json.scheme!==s.scheme)throw Error('Public key scheme mismatch');
  return (await falcon())[s.alg].verify(new Uint8Array(signature),new Uint8Array(message),new Uint8Array(Buffer.from(json.publicKey,'base64')));
}

export function parseArgs(argv){
  const out={_:[]};
  for(let i=0;i<argv.length;i++){const a=argv[i];if(!a.startsWith('--')){out._.push(a);continue;}const [k,v]=a.slice(2).split('=',2);const value=v!==undefined?v:(argv[i+1]&&!argv[i+1].startsWith('--')?argv[++i]:true);(out[k]??=[]).push(value);}
  return out;
}
