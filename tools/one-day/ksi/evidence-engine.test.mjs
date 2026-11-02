import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {readFile,mkdtemp,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonical,sha256,validateBoundary,dependencyInventory,ingestAudit,publicKeyIdentity,makeChallenge,verifySignerBinding,collect,boundedRead} from './evidence-engine.mjs';

const root=fileURLToPath(new URL('.',import.meta.url));
const config=JSON.parse(await readFile(new URL('./collector-config.json',import.meta.url)));
const fixed=Date.parse('2026-11-02T12:00:00.000Z');
const keyVersion='projects/project-0317d6c9-e943-409e-83f/locations/us-central1/keyRings/runtime/cryptoKeys/ed25519/cryptoKeyVersions/1';
function signedProbe(){
 const {privateKey,publicKey}=generateKeyPairSync('ed25519');
 const publicKeyPem=publicKey.export({format:'pem',type:'spki'});
 const pins={keyVersion,audience:'https://numinalabs.xyz',spkiSha256:publicKeyIdentity(publicKeyPem).spkiSha256};
 const challenge=makeChallenge({...pins,now:fixed});
 const binding={schema:'numina.runtime-signer-binding.v1',algorithm:'EC_SIGN_ED25519',protectionLevel:'SOFTWARE',keyVersion,publicKeyPem,signatureBase64:sign(null,Buffer.from(canonical(challenge)),privateKey).toString('base64')};
 return {pins,challenge,binding};
}
test('source snapshot collection verifies git blobs, inventory and blocked release status',async()=>{
 const result=await collect({root,config,now:new Date(fixed).toISOString()});
 assert.equal(result.source.commit,'23c38e1e3a15e8f6559486ca024edb2faa3244cb');
 assert.equal(result.source.artifacts.length,3);assert.ok(result.dependencies.packageCount>0);
 assert.equal(result.signer.status,'blocked');assert.equal(result.dependencies.audit.status,'blocked');
 assert.equal(result.validationCoverage.validatedKsis,0);assert.equal(result.releaseGate,'blocked');
 const {evidenceSha256,...body}=result;assert.equal(evidenceSha256,sha256(canonical(body)));
});
test('candidate boundary includes all 20 families and cannot self-approve',()=>{
 const b=structuredClone(config.boundary);assert.equal(validateBoundary(b).familyCount,20);
 b.controlFamilies=b.controlFamilies.slice(0,11);assert.throws(()=>validateBoundary(b),/FAMILY_COVERAGE/);
 const approved={...config.boundary,freezeState:'approved'};assert.throws(()=>validateBoundary(approved),/UNVERIFIED_APPROVAL/);
});
test('duplicate families and malformed applicability are rejected',()=>{
 const b=structuredClone(config.boundary);b.controlFamilies[0].family='AT';assert.throws(()=>validateBoundary(b),/FAMILY_COVERAGE/);
 const c=structuredClone(config.boundary);c.controlFamilies[0].applicability='verified';assert.throws(()=>validateBoundary(c),/INVALID_APPLICABILITY/);
});
test('dependency inventory is exact-version evidence and never a vulnerability clearance',()=>{
 const v=dependencyInventory({lockfileVersion:3,packages:{'':{},'node_modules/@scope/pkg':{version:'1.2.3',integrity:'sha512-example'}}});
 assert.equal(v.packages[0].name,'@scope/pkg');assert.equal(v.vulnerabilityStatus,'not_scanned');
 assert.throws(()=>dependencyInventory({lockfileVersion:1}),/UNSUPPORTED_LOCKFILE/);
 assert.throws(()=>dependencyInventory({lockfileVersion:3,packages:{'node_modules/pkg':{}}}),/INVALID_LOCK_PACKAGE/);
});
test('imported vulnerability observations require lock binding, freshness and installed names',()=>{
 const inventory=dependencyInventory({lockfileVersion:3,packages:{'node_modules/pkg':{version:'1.0.0'}}});
 const report={schema:'numina.npm-audit-input.v1',sourceLockSha256:'a'.repeat(64),observedAt:new Date(fixed).toISOString(),scanner:{name:'npm audit',version:'11.0.0'},report:{auditReportVersion:2,vulnerabilities:{pkg:{severity:'high',via:[{source:123}]}}}};
 assert.equal(ingestAudit(report,'a'.repeat(64),inventory,fixed).reportedFindingCount,1);
 assert.throws(()=>ingestAudit(report,'b'.repeat(64),inventory,fixed),/AUDIT_LOCK_MISMATCH/);
 assert.throws(()=>ingestAudit(report,'a'.repeat(64),inventory,fixed+86400001),/AUDIT_STALE_OR_FUTURE/);
 const future={...report,observedAt:new Date(fixed+300001).toISOString()};assert.throws(()=>ingestAudit(future,'a'.repeat(64),inventory,fixed),/AUDIT_STALE_OR_FUTURE/);
 const wrong=structuredClone(report);wrong.report.vulnerabilities.other=wrong.report.vulnerabilities.pkg;assert.throws(()=>ingestAudit(wrong,'a'.repeat(64),inventory,fixed),/AUDIT_FINDING_INVALID/);
});
test('a fresh full-key challenge verifies possession but never proves KMS or deployment origin',()=>{
 const {pins,challenge,binding}=signedProbe();const result=verifySignerBinding(binding,pins,challenge,fixed);
 assert.equal(result.status,'cryptographically_verified');assert.equal(result.runtimeDeploymentBinding,'unverified');assert.equal(result.kmsProviderOrigin,'unverified');
 assert.equal(result.spkiSha256.length,64);assert.equal(result.rawSha256.length,64);
});
test('key fragments, HSM claims, wrong fingerprints and altered payloads fail closed',()=>{
 const {pins,challenge,binding}=signedProbe();
 assert.throws(()=>verifySignerBinding({...binding,keyVersion:'3a2fe594a7e10458ae89683f'},pins,challenge,fixed),/FULL_KEY_VERSION_MISMATCH/);
 assert.throws(()=>verifySignerBinding({...binding,protectionLevel:'HSM'},pins,challenge,fixed),/PROTECTION_LEVEL_UNSUPPORTED/);
 assert.throws(()=>verifySignerBinding(binding,{...pins,spkiSha256:'b'.repeat(64)},challenge,fixed),/FINGERPRINT_MISMATCH/);
 assert.throws(()=>verifySignerBinding(binding,pins,{...challenge,nonce:'a'.repeat(64)},fixed),/SIGNATURE_INVALID/);
});
test('expired challenges and audience/key-version substitution are rejected',()=>{
 const {pins,challenge,binding}=signedProbe();
 assert.throws(()=>verifySignerBinding(binding,pins,challenge,fixed+300000),/CHALLENGE_EXPIRED_OR_INVALID/);
 assert.throws(()=>verifySignerBinding(binding,{...pins,audience:'https://other.test'},challenge,fixed),/CHALLENGE_CONTEXT_MISMATCH/);
 assert.throws(()=>verifySignerBinding(binding,pins,{...challenge,keyVersion:keyVersion+'1'},fixed),/CHALLENGE_CONTEXT_MISMATCH/);
});
test('public-key reader rejects private material and non-Ed25519 keys',()=>{
 const pair=generateKeyPairSync('ed25519');assert.throws(()=>publicKeyIdentity(pair.privateKey.export({format:'pem',type:'pkcs8'})),/PUBLIC_KEY_REQUIRED/);
 const rsa=generateKeyPairSync('rsa',{modulusLength:2048});assert.throws(()=>publicKeyIdentity(rsa.publicKey.export({format:'pem',type:'spki'})),/ED25519_REQUIRED/);
});
test('canonical serialization has stable order and rejects malformed values',()=>{
 assert.equal(canonical({z:1,a:[true,null,'ok']}),'{"a":[true,null,"ok"],"z":1}');
 for(const value of [undefined,NaN,Infinity,{x:undefined},'\ud800','\udc00',Array(2)])assert.throws(()=>canonical(value));
});
test('artifact reader rejects path traversal and symlink escapes',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ksi-path-'));try{
  await writeFile(join(dir,'outside.json'),'{}');const inside=join(dir,'inside');await import('node:fs/promises').then(fs=>fs.mkdir(inside));
  await symlink(join(dir,'outside.json'),join(inside,'escape.json'));
  await assert.rejects(()=>boundedRead(inside,'../outside.json'),/PATH_OUTSIDE_ROOT/);
  await assert.rejects(()=>boundedRead(inside,'escape.json'),/PATH_OUTSIDE_ROOT/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('tampered source bytes cannot be presented under the pinned Git blob identity',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ksi-source-'));try{
  const item={path:'file',local:'file',gitBlobSha:'a'.repeat(40)};await writeFile(join(dir,'file'),'changed');
  await writeFile(join(dir,'source.json'),JSON.stringify({repository:'repo',commit:'a'.repeat(40),files:[item]}));
  await assert.rejects(()=>collect({root:dir,config:{...config,sourceManifest:'source.json'},now:new Date(fixed).toISOString()}),/SOURCE_BLOB_MISMATCH/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
