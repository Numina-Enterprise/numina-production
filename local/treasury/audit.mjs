// Append-only, hash-chained audit log (JSONL). Every attempted call is recorded, allowed or
// blocked. Each entry carries sha256(prev hash + canonical entry); when an Ed25519 signing key
// is provided via env (PKCS#8, base64 DER or PEM) each entry hash is also signed.
// Entries are redacted before writing: no tokens, keys or Authorization values.
import {appendFileSync,readFileSync,existsSync,mkdirSync,openSync,closeSync,fstatSync} from 'node:fs';
import {createHash,createPrivateKey,createPublicKey,sign,verify} from 'node:crypto';
import path from 'node:path';
import {redact} from './redact.mjs';

export const GENESIS='0'.repeat(64);
const canon=v=>Array.isArray(v)?`[${v.map(canon).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canon(v[k])).join(',')}}`:JSON.stringify(v);
const sha=s=>createHash('sha256').update(s).digest('hex');
export const argsDigest=a=>sha(canon(a??{}));

function loadKey(env,name){
  const raw=env[name];if(!raw)return null;
  const key=raw.includes('BEGIN')?createPrivateKey(raw):createPrivateKey({key:Buffer.from(raw,'base64'),format:'der',type:'pkcs8'});
  if(key.asymmetricKeyType!=='ed25519')throw new Error(`${name} must be an Ed25519 private key`);
  const spki=createPublicKey(key).export({type:'spki',format:'der'});
  return {key,publicKey:spki.toString('base64'),keyId:sha(spki).slice(0,16)};
}
function lastEntry(file){
  if(!existsSync(file))return null;
  const lines=readFileSync(file,'utf8').split('\n').filter(Boolean);
  return lines.length?JSON.parse(lines[lines.length-1]):null;
}
export function createAuditLog({file,env=process.env,signingKeyEnv,secrets=()=>[]}){
  const signer=signingKeyEnv?loadKey(env,signingKeyEnv):null;
  mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  if(!existsSync(file))closeSync(openSync(file,'a',0o600));
  return {
    file,signed:!!signer,keyId:signer?.keyId||null,publicKey:signer?.publicKey||null,
    append(event){
      const last=lastEntry(file);
      const body={seq:(last?.seq??-1)+1,ts:new Date().toISOString(),prev:last?.hash||GENESIS,event:redact(event,secrets())};
      const hash=sha(canon(body));
      const entry={...body,hash};
      if(signer){entry.keyId=signer.keyId;entry.sig=sign(null,Buffer.from(hash,'hex'),signer.key).toString('base64');}
      appendFileSync(file,JSON.stringify(entry)+'\n',{mode:0o600});
      return entry;
    }
  };
}
// Verifies the full chain. Pass publicKey (base64 SPKI DER) to require valid signatures.
export function verifyAuditLog(file,{publicKey,requireSignatures=!!publicKey}={}){
  if(!existsSync(file))return {ok:true,entries:0};
  const pub=publicKey?createPublicKey({key:Buffer.from(publicKey,'base64'),format:'der',type:'spki'}):null;
  const lines=readFileSync(file,'utf8').split('\n').filter(Boolean);
  let prev=GENESIS;
  for(let i=0;i<lines.length;i++){
    let e;try{e=JSON.parse(lines[i]);}catch{return {ok:false,at:i,reason:'unparseable line'};}
    const {hash,sig,keyId,...body}=e;
    if(body.seq!==i)return {ok:false,at:i,reason:'sequence gap or reorder'};
    if(body.prev!==prev)return {ok:false,at:i,reason:'chain broken (prev hash mismatch)'};
    if(sha(canon(body))!==hash)return {ok:false,at:i,reason:'entry hash mismatch (modified)'};
    if(requireSignatures&&!sig)return {ok:false,at:i,reason:'missing signature'};
    if(pub&&sig&&!verify(null,Buffer.from(hash,'hex'),pub,Buffer.from(sig,'base64')))return {ok:false,at:i,reason:'bad signature'};
    prev=hash;
  }
  return {ok:true,entries:lines.length,head:prev};
}
export function readAudit(file,{limit=100}={}){
  if(!existsSync(file))return [];
  return readFileSync(file,'utf8').split('\n').filter(Boolean).slice(-limit).map(l=>JSON.parse(l));
}
