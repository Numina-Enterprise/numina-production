import {generateKeyPairSync} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {freshCredential,signCredential,verifyCredential} from '../src/core.js';
const path=new URL('../fixtures/demo-test-key.json',import.meta.url);
if(!existsSync(path)){const {publicKey,privateKey}=generateKeyPairSync('ed25519');writeFileSync(path,JSON.stringify({kid:'numina-demo-eac-1',purpose:'eac-test-authorization',issuer:'numina-demo',jwk:publicKey.export({format:'jwk'}),privateJwk:privateKey.export({format:'jwk'}),warning:'PUBLIC TEST KEY. Never use for real authority.'},null,2));}
const key=JSON.parse(readFileSync(path)),now=1800000000,base=freshCredential(now);base.eventId='conformance-event';base.nonce='conformance-nonce-0000000001';
const definitions=[
 ['valid',{},'VALID_FOR_COMMIT','TEST_AUTHORITY_VALID'],
 ['wrong environment',{environment:'production'},'INVALID','SCOPE_DENIED'],
 ['wrong audience',{audience:'other'},'INVALID','SCOPE_DENIED'],
 ['wrong action',{action:'transfer'},'INVALID','SCOPE_DENIED'],
 ['wrong resource',{resource:'real:ledger'},'INVALID','SCOPE_DENIED'],
 ['wrong issuer',{issuer:'other'},'INVALID','KEY_PURPOSE_OR_ISSUER'],
 ['profile changed',{profile:'other'},'REVALIDATION_REQUIRED','PROFILE_CHANGED'],
 ['expired',{issuedAt:now-600,notBefore:now-600,expiresAt:now},'REVALIDATION_REQUIRED','EXPIRED'],
 ['not yet valid',{issuedAt:now+1,notBefore:now+1,expiresAt:now+300},'REVALIDATION_REQUIRED','NOT_YET_VALID'],
 ['lifetime exceeded',{expiresAt:now+601},'INVALID','TIME_RANGE_INVALID'],
 ['inverted window',{notBefore:now+400},'INVALID','TIME_RANGE_INVALID'],
 ['issuance after activation',{issuedAt:now+1},'INVALID','TIME_RANGE_INVALID'],
 ['short nonce',{nonce:'short'},'INVALID','SCHEMA_INVALID'],
 ['unsupported version',{version:'0.2'},'INVALID','SCOPE_DENIED'],
 ['extra field',{funds:100},'INVALID','SCHEMA_INVALID'],
 ['fractional time',{issuedAt:now+0.5},'INVALID','SCHEMA_INVALID'],
];
const vectors=[];
for(const [name,change,outcome,reason]of definitions){let envelope;if(name==='fractional time'){envelope=await signCredential({...base},key.privateJwk);envelope.credential.issuedAt=now+0.5;}else envelope=await signCredential({...base,...change},key.privateJwk);vectors.push({name,now,envelope,expected:{outcome,reason}});}
for(const [name,field,value,reason]of [['tampered signature','value','A'.repeat(86),'SIGNATURE_INVALID'],['untrusted key','kid','unknown','UNTRUSTED_KEY'],['wrong key purpose','purpose','external-test-receipt','KEY_PURPOSE_OR_ISSUER'],['unsupported algorithm','alg','none','SCHEMA_INVALID']]){const envelope=await signCredential({...base},key.privateJwk);envelope.signature[field]=value;vectors.push({name,now,envelope,expected:{outcome:'INVALID',reason}});}
const results=[];for(const v of vectors){const got=await verifyCredential(v.envelope,[key],v.now);const pass=got.outcome===v.expected.outcome&&got.reason===v.expected.reason;results.push({name:v.name,pass});if(!pass)throw new Error(v.name+JSON.stringify(got));}
writeFileSync(new URL('../fixtures/conformance-vectors.json',import.meta.url),JSON.stringify({notice:'Implementation vectors, not the unavailable original 20 constitutional scenarios.',key:{...key,privateJwk:undefined},vectors},null,2));
writeFileSync(new URL('../fixtures/conformance-report.json',import.meta.url),JSON.stringify({suite:'numina-implementation-v0.1',passed:results.length,total:results.length,results},null,2));
console.log('Generated and verified '+results.length+' signed conformance vectors.');

