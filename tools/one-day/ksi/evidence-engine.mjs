import {createHash,createPublicKey,verify,randomBytes} from 'node:crypto';
import {writeFile,realpath,open} from 'node:fs/promises';
import {resolve,relative,sep} from 'node:path';
import {pathToFileURL} from 'node:url';

export const SCHEMA='numina.ksi-evidence.v1';
export const FAMILIES=Object.freeze(['AC','AT','AU','CA','CM','CP','IA','IR','MA','MP','PE','PL','PM','PS','PT','RA','SA','SC','SI','SR']);
const KMS_VERSION=/^projects\/[a-z][a-z0-9-]{4,61}[a-z0-9]\/locations\/[a-z0-9-]+\/keyRings\/[A-Za-z0-9_-]+\/cryptoKeys\/[A-Za-z0-9_-]+\/cryptoKeyVersions\/[1-9][0-9]*$/;
const HEX=/^[a-f0-9]{64}$/;
export const sha256=value=>createHash('sha256').update(value).digest('hex');
function fail(code){throw new Error(code);}
function assert(value,code){if(!value)fail(code);}
function validString(s){for(let i=0;i<s.length;i++){const n=s.charCodeAt(i);if(n>=0xd800&&n<=0xdbff){assert(i+1<s.length&&s.charCodeAt(++i)>=0xdc00&&s.charCodeAt(i)<=0xdfff,'INVALID_UNICODE');}else assert(n<0xdc00||n>0xdfff,'INVALID_UNICODE');}return s;}
// Deterministic I-JSON serialization: reject non-JSON values and malformed Unicode.
export function canonical(value){
 if(value===null||typeof value==='boolean')return JSON.stringify(value);
 if(typeof value==='string')return JSON.stringify(validString(value));
 if(typeof value==='number'){assert(Number.isFinite(value),'NONFINITE_NUMBER');return JSON.stringify(value);}
 if(Array.isArray(value)){const keys=Object.keys(value);assert(keys.length===value.length&&keys.every((k,i)=>k===String(i)),'SPARSE_OR_EXTENDED_ARRAY');return '['+value.map(canonical).join(',')+']';}
 assert(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype,'INVALID_JSON_VALUE');
 return '{'+Object.keys(value).sort().map(k=>JSON.stringify(validString(k))+':'+canonical(value[k])).join(',')+'}';
}
export async function boundedRead(root,path,max=4*1024*1024){
 assert(typeof path==='string'&&!path.includes('\0'),'INVALID_PATH');
 const rootReal=await realpath(root),file=await realpath(resolve(rootReal,path)),rel=relative(rootReal,file);
 assert(rel!==''&&!rel.startsWith('..'+sep)&&rel!=='..'&&!resolve(rootReal,rel).startsWith(rootReal+sep+'..'),'PATH_OUTSIDE_ROOT');
 const handle=await open(file,'r');try{
  const metadata=await handle.stat();assert(metadata.isFile()&&metadata.size<=max,'INPUT_TOO_LARGE');
  const chunks=[];let size=0;for(;;){const buffer=Buffer.alloc(Math.min(65536,max-size+1));const {bytesRead}=await handle.read(buffer,0,buffer.length,null);if(!bytesRead)break;size+=bytesRead;assert(size<=max,'INPUT_TOO_LARGE');chunks.push(buffer.subarray(0,bytesRead));}return Buffer.concat(chunks,size);
 }finally{await handle.close();}
}
export function validateBoundary(boundary){
 assert(boundary?.schema==='numina.s0-boundary.v1','BOUNDARY_SCHEMA');
 assert(Array.isArray(boundary.controlFamilies)&&boundary.controlFamilies.length===FAMILIES.length,'FAMILY_COVERAGE');
 const names=boundary.controlFamilies.map(x=>x.family);assert(new Set(names).size===FAMILIES.length&&FAMILIES.every(x=>names.includes(x)),'FAMILY_COVERAGE');
 for(const f of boundary.controlFamilies)assert(['unreviewed','applicable','not_applicable'].includes(f.applicability),'INVALID_APPLICABILITY');
 assert(Array.isArray(boundary.surfaces)&&boundary.surfaces.length>0,'BOUNDARY_SURFACES');
 assert(boundary.freezeState==='candidate','UNVERIFIED_APPROVAL');
 return {status:'blocked',candidateSha256:sha256(canonical(boundary)),reason:'OWNER_APPROVAL_AND_RESTORE_EVIDENCE_REQUIRED',familyCount:FAMILIES.length,unreviewed:boundary.controlFamilies.filter(x=>x.applicability==='unreviewed').length,restorePerformed:false};
}
export function dependencyInventory(lock){
 assert([2,3].includes(lock?.lockfileVersion)&&lock.packages&&typeof lock.packages==='object'&&!Array.isArray(lock.packages),'UNSUPPORTED_LOCKFILE');
 const packages=Object.entries(lock.packages).filter(([path])=>path!=='').map(([path,p])=>{
  assert(p&&typeof p==='object'&&typeof p.version==='string'&&p.version.length>0,'INVALID_LOCK_PACKAGE');
  const name=p.name||path.split('node_modules/').at(-1);assert(name&&name.length<300,'INVALID_LOCK_PACKAGE');
  return {path,name,version:p.version,dev:p.dev===true,integrity:typeof p.integrity==='string'?p.integrity:null};
 }).sort((a,b)=>a.path.localeCompare(b.path));
 return {status:'observed',lockfileVersion:lock.lockfileVersion,packageCount:packages.length,missingIntegrity:packages.filter(p=>!p.integrity).length,packages,vulnerabilityStatus:'not_scanned'};
}
export function ingestAudit(envelope,lockSha256,inventory,now=Date.now()){
 assert(envelope?.schema==='numina.npm-audit-input.v1','AUDIT_SCHEMA');
 assert(HEX.test(envelope.sourceLockSha256||'')&&envelope.sourceLockSha256===lockSha256,'AUDIT_LOCK_MISMATCH');
 const time=Date.parse(envelope.observedAt);assert(Number.isFinite(time)&&time<=now+300000&&now-time<=86400000,'AUDIT_STALE_OR_FUTURE');
 assert(typeof envelope.scanner?.name==='string'&&typeof envelope.scanner?.version==='string','AUDIT_SCANNER_IDENTITY');
 const report=envelope.report;assert(report?.auditReportVersion===2&&report.vulnerabilities&&typeof report.vulnerabilities==='object'&&!Array.isArray(report.vulnerabilities),'AUDIT_REPORT_SCHEMA');
 const known=new Set(inventory.packages.map(p=>p.name));const findings=Object.entries(report.vulnerabilities).map(([name,v])=>{
  assert(known.has(name)&&['info','low','moderate','high','critical'].includes(v?.severity)&&Array.isArray(v.via),'AUDIT_FINDING_INVALID');
  return {name,severity:v.severity,advisoryIds:v.via.filter(x=>typeof x==='object').map(x=>x.source).filter(x=>typeof x==='number')};
 });
 return {status:'observed',scanner:envelope.scanner,observedAt:envelope.observedAt,sourceLockSha256:lockSha256,findings,reportedFindingCount:findings.length,interpretation:'Imported scanner output; authentic scanner execution and assessment acceptance are not established by ingestion.'};
}
export function publicKeyIdentity(pem){
 assert(typeof pem==='string'&&pem.includes('BEGIN PUBLIC KEY')&&!pem.includes('PRIVATE'),'PUBLIC_KEY_REQUIRED');
 const key=createPublicKey(pem);assert(key.asymmetricKeyType==='ed25519','ED25519_REQUIRED');
 const spki=key.export({format:'der',type:'spki'});const raw=spki.subarray(-32);
 return {key,spkiSha256:sha256(spki),rawSha256:sha256(raw),rawBase64:raw.toString('base64')};
}
export function makeChallenge({audience,keyVersion,now=Date.now()}){
 assert(typeof audience==='string'&&audience.startsWith('https://'),'HTTPS_AUDIENCE_REQUIRED');assert(KMS_VERSION.test(keyVersion||''),'FULL_KEY_VERSION_REQUIRED');
 return {schema:'numina.runtime-signer-challenge.v1',nonce:randomBytes(32).toString('hex'),audience,keyVersion,issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+300000).toISOString()};
}
export function verifySignerBinding(binding,pins,challenge,now=Date.now()){
 assert(binding?.schema==='numina.runtime-signer-binding.v1'&&binding.algorithm==='EC_SIGN_ED25519','SIGNER_BINDING_SCHEMA');
 assert(binding.protectionLevel==='SOFTWARE','ED25519_PROTECTION_LEVEL_UNSUPPORTED');
 assert(KMS_VERSION.test(binding.keyVersion||'')&&binding.keyVersion===pins.keyVersion,'FULL_KEY_VERSION_MISMATCH');
 assert(challenge?.schema==='numina.runtime-signer-challenge.v1'&&/^[a-f0-9]{64}$/.test(challenge.nonce||''),'CHALLENGE_INVALID');
 const issued=Date.parse(challenge.issuedAt),expires=Date.parse(challenge.expiresAt);
 assert(Number.isFinite(issued)&&Number.isFinite(expires)&&expires>issued&&expires-issued<=300000&&issued<=now+30000&&expires>now,'CHALLENGE_EXPIRED_OR_INVALID');
 assert(challenge.audience===pins.audience&&challenge.keyVersion===binding.keyVersion,'CHALLENGE_CONTEXT_MISMATCH');
 const identity=publicKeyIdentity(binding.publicKeyPem);
 assert(HEX.test(pins.spkiSha256||'')&&identity.spkiSha256===pins.spkiSha256,'FINGERPRINT_MISMATCH');
 assert(typeof binding.signatureBase64==='string'&&/^[A-Za-z0-9+/]{86}==$/.test(binding.signatureBase64),'SIGNATURE_ENCODING');
 const signature=Buffer.from(binding.signatureBase64,'base64');assert(signature.length===64&&verify(null,Buffer.from(canonical(challenge)),identity.key,signature),'SIGNATURE_INVALID');
 return {status:'cryptographically_verified',algorithm:binding.algorithm,protectionLevel:binding.protectionLevel,keyVersion:binding.keyVersion,spkiSha256:identity.spkiSha256,rawSha256:identity.rawSha256,challengeSha256:sha256(canonical(challenge)),runtimeDeploymentBinding:'unverified',kmsProviderOrigin:'unverified',note:'A valid signature proves key possession for this challenge, not that KMS or the deployed runtime produced it. Provider audit/deployment evidence is separate.'};
}
export async function collect({root,config,now=new Date().toISOString(),auditPath=null,bindingPath=null,challengePath=null}){
 assert(Number.isFinite(Date.parse(now)),'INVALID_TIME');validateBoundary(config.boundary);
 const sourceBytes=await boundedRead(root,config.sourceManifest),sources=JSON.parse(sourceBytes);
 assert(/^[a-f0-9]{40}$/.test(sources.commit||'')&&Array.isArray(sources.files),'SOURCE_MANIFEST_INVALID');
 const artifacts=[];for(const item of sources.files){const bytes=await boundedRead(root,item.local);const gitBlobSha=createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');assert(gitBlobSha===item.gitBlobSha,'SOURCE_BLOB_MISMATCH');artifacts.push({path:item.path,sha256:sha256(bytes),gitBlobSha,bytes:bytes.length});}
 const lockBytes=await boundedRead(root,config.lockfile),lockSha=sha256(lockBytes),inventory=dependencyInventory(JSON.parse(lockBytes));
 let audit={status:'blocked',reason:'FRESH_SCANNER_REPORT_REQUIRED',findings:null};if(auditPath)audit=ingestAudit(JSON.parse(await boundedRead(root,auditPath)),lockSha,inventory,Date.parse(now));
 let signer={status:'blocked',reason:'FULL_KMS_KEY_VERSION_AND_FRESH_SIGNED_CHALLENGE_REQUIRED',runtimeBindingVerified:false};
 if(bindingPath||challengePath){assert(bindingPath&&challengePath,'BINDING_AND_CHALLENGE_REQUIRED');signer=verifySignerBinding(JSON.parse(await boundedRead(root,bindingPath)),config.signerPins,JSON.parse(await boundedRead(root,challengePath)),Date.parse(now));}
 const body={schema:SCHEMA,observedAt:now,classification:'source_observation_not_authorization',source:{repository:sources.repository,commit:sources.commit,artifacts},boundary:validateBoundary(config.boundary),dependencies:{lockSha256:lockSha,...inventory,audit},signer,validationCoverage:{requiredMethodsPerKsi:2,requirementSource:'FRC-CSX-VVK (2026-10-13 ruleset reference)',implementedCollectors:['source_hash_inventory','npm_lock_inventory','external_audit_ingestion','signer_challenge_verification'],validatedKsis:0,allKsisCovered:false,continuousCollectionEstablished:false},releaseGate:'blocked',limitations:['No S0 owner approval or restore drill evidence supplied.','No authenticated KMS/runtime observation has been performed.','Source metadata is not a deployment attestation.','These collectors do not establish FedRAMP certification or 3PAO acceptance.']};
 return {...body,evidenceSha256:sha256(canonical(body))};
}
async function main(){
 const args=process.argv.slice(2),command=args.shift();const options={};assert(args.length%2===0,'ARGUMENT_PAIRS_REQUIRED');for(let i=0;i<args.length;i+=2){assert(args[i].startsWith('--')&&!Object.hasOwn(options,args[i]),'INVALID_ARGUMENT');options[args[i]]=args[i+1];}
 if(command==='challenge'){const challenge=makeChallenge({audience:options['--audience'],keyVersion:options['--key-version']});await writeFile(options['--output'],canonical(challenge)+'\n',{flag:'wx'});return;}
 assert(command==='collect','USE_COLLECT_OR_CHALLENGE');assert(options['--root']&&options['--config']&&options['--output'],'ROOT_CONFIG_OUTPUT_REQUIRED');
 const config=JSON.parse(await boundedRead(options['--root'],options['--config']));const result=await collect({root:options['--root'],config,auditPath:options['--audit']||null,bindingPath:options['--binding']||null,challengePath:options['--challenge']||null});
 await writeFile(options['--output'],JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({schema:result.schema,evidenceSha256:result.evidenceSha256,releaseGate:result.releaseGate}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{console.error(JSON.stringify({error:e.message}));process.exitCode=1;});
