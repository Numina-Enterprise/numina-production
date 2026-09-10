export const VERSION = '0.1.0';
export const PROFILE = Object.freeze({id:'numina-demo-rp-0.1',version:'0.1',environment:'test',issuer:'numina-demo',audience:'numina-demo-gateway',action:'simulate.commit',maxLifetimeSeconds:600,keyPurpose:'eac-test-authorization',canonicalization:'numina-ascii-json-v0.1',invariants:'C1-C14 source mapping pending'});
export const encoder = new TextEncoder();
export function canonical(value) {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value) && !Object.is(value,-0)) return String(value);
  if (typeof value === 'string' && /^[\x20-\x7e]*$/.test(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if (value && Object.getPrototypeOf(value) === Object.prototype) return '{'+Object.keys(value).sort().map(k=>canonical(k)+':'+canonical(value[k])).join(',')+'}';
  throw new Error('NON_CANONICAL_VALUE');
}
export const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
export function unb64(s) { if (typeof s!=='string'||!s.length||!/^[A-Za-z0-9_-]+$/.test(s)) throw new Error('BASE64'); const b=Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0)); if(b64(b)!==s)throw new Error('BASE64'); return b; }
export async function digest(x) { return b64(await crypto.subtle.digest('SHA-256',encoder.encode(typeof x==='string'?x:canonical(x)))); }
export function exact(o,keys) { return o && !Array.isArray(o) && typeof o==='object' && Object.keys(o).sort().join(',')===keys.split(',').sort().join(','); }
export const token = s => typeof s==='string' && /^[A-Za-z0-9:_-]{1,100}$/.test(s);
export function schema(e) {
  if(!exact(e,'credential,signature')||!exact(e.signature,'alg,kid,purpose,value'))return false;
  const c=e.credential,s=e.signature;
  if(!exact(c,'version,environment,issuer,subject,audience,profile,action,resource,eventId,nonce,issuedAt,notBefore,expiresAt')) return false;
  if(!['version','environment','issuer','subject','audience','profile','action','resource','eventId','nonce'].every(k=>typeof c[k]==='string'&&c[k].length<=100))return false;
  if(!['subject','eventId','nonce'].every(k=>token(c[k]))||c.nonce.length<22)return false;
  if(!['issuedAt','notBefore','expiresAt'].every(k=>Number.isSafeInteger(c[k])&&c[k]>=0))return false;
  return s.alg==='Ed25519'&&token(s.kid)&&token(s.purpose)&&typeof s.value==='string'&&/^[A-Za-z0-9_-]{86}$/.test(s.value);
}
export const decision=(outcome,reason)=>({outcome,reason,profile:PROFILE.id,version:VERSION,scope:'test-only'});
export async function verifyCredential(e,keys,now=Math.floor(Date.now()/1000)) {
  if(!schema(e))return decision('INVALID','SCHEMA_INVALID');
  const c=e.credential,s=e.signature;
  const k=keys.find(k=>k.kid===s.kid);
  if(!k)return decision('INVALID','UNTRUSTED_KEY');
  if(s.purpose!==PROFILE.keyPurpose||k.purpose!==s.purpose||k.issuer!==c.issuer)return decision('INVALID','KEY_PURPOSE_OR_ISSUER');
  if(k.revoked)return decision('INVALID','KEY_REVOKED');
  try { const pk=await crypto.subtle.importKey('jwk',k.jwk,{name:'Ed25519'},false,['verify']); if(!await crypto.subtle.verify('Ed25519',pk,unb64(s.value),encoder.encode(canonical({credential:c,protected:{alg:s.alg,kid:s.kid,purpose:s.purpose}}))))return decision('INVALID','SIGNATURE_INVALID'); } catch {return decision('INVALID','SIGNATURE_INVALID');}
  if(c.version!=='0.1'||c.environment!=='test'||c.issuer!==PROFILE.issuer||c.audience!==PROFILE.audience||c.action!==PROFILE.action||c.resource!=='demo:ledger')return decision('INVALID','SCOPE_DENIED');
  if(c.profile!==PROFILE.id)return decision('REVALIDATION_REQUIRED','PROFILE_CHANGED');
  if(c.issuedAt>c.notBefore||c.notBefore>=c.expiresAt||c.expiresAt-c.issuedAt>PROFILE.maxLifetimeSeconds)return decision('INVALID','TIME_RANGE_INVALID');
  if(c.issuedAt>now||c.notBefore>now)return decision('REVALIDATION_REQUIRED','NOT_YET_VALID');
  if(c.expiresAt<=now)return decision('REVALIDATION_REQUIRED','EXPIRED');
  return decision('VALID_FOR_COMMIT','TEST_AUTHORITY_VALID');
}
export async function signCredential(c,jwk,kid='numina-demo-eac-1') {
  const protectedHeader={alg:'Ed25519',kid,purpose:PROFILE.keyPurpose};
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'Ed25519'},false,['sign']);
  const value=b64(await crypto.subtle.sign('Ed25519',key,encoder.encode(canonical({credential:c,protected:protectedHeader}))));
  return {credential:c,signature:{...protectedHeader,value}};
}
export function freshCredential(now=Math.floor(Date.now()/1000)) {return {version:'0.1',environment:'test',issuer:PROFILE.issuer,subject:'demo-user',audience:PROFILE.audience,profile:PROFILE.id,action:PROFILE.action,resource:'demo:ledger',eventId:crypto.randomUUID(),nonce:crypto.randomUUID(),issuedAt:now,notBefore:now,expiresAt:now+300};}
