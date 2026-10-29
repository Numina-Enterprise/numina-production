import {readFileSync,readdirSync,lstatSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {createHash,createPublicKey,verify} from 'node:crypto';

// Public-only, exact-byte verification. The operational trust anchor is fixed.
const root='/workspace/outputs/Numina-Protocol-Closure-Progress-2026-10-11';
const publicHex='f29ec679836c6889ef87d41b842bfd2236004c1a6d84d4bac0814cae45a90c28';
const publicSha256='b217cc5bae08acbfdb9f8cd20f420f0bee2ae39fb6f0b178ce060284c76f8e9f';
const inventorySha256='be27db7c238ee53a673862aafb9af5bbb3ca32bbb0355bbb2a1b935ab09dd4f4';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const assert=(value,message)=>{if(!value)throw Error(message);};
const publicBytes=Buffer.from(publicHex,'hex');
assert(sha(publicBytes)===publicSha256,'Established public key pin mismatch');
assert(readFileSync(join(root,'operational-ed25519-public.raw32')).equals(publicBytes),'Retained public key differs');
const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),publicBytes]),format:'der',type:'spki'});
const inventoryBytes=readFileSync(join(root,'inventory.json'));
assert(sha(inventoryBytes)===inventorySha256,'Frozen inventory differs');
const inventory=JSON.parse(inventoryBytes),names=new Set();
for(const row of inventory.files){
  const path=resolve(root,row.path);
  assert(path.startsWith(root+'/')&&!names.has(row.path)&&!lstatSync(path).isSymbolicLink(),'Invalid retained inventory path');
  names.add(row.path);const bytes=readFileSync(path);
  assert(bytes.length===row.bytes&&sha(bytes)===row.sha256,'Retained inventory bytes differ: '+row.path);
}
let count=0;
function verifySignature(path,message){
  const signature=readFileSync(path);
  assert(signature.length===64&&verify(null,message,key,signature),'Retained signature failed: '+path);
  count++;
}
function walk(directory){
  for(const name of readdirSync(directory)){
    const path=join(directory,name),stat=lstatSync(path);
    assert(!stat.isSymbolicLink(),'Unexpected signature symbolic link');
    if(stat.isDirectory()){walk(path);continue;}
    assert(name.endsWith('.ed25519.sig64'),'Unexpected signature format');
    const relative=path.slice(join(root,'signatures').length+1).slice(0,-'.ed25519.sig64'.length);
    const message=resolve(root,relative);assert(message.startsWith(root+'/'),'Invalid signed path');
    verifySignature(path,readFileSync(message));
  }
}
walk(join(root,'signatures'));
const zip='/workspace/outputs/Numina-Protocol-Closure-Progress-signed-2026-10-11.zip';
const checksum=readFileSync(zip+'.sha256'),line=checksum.toString('utf8');
const expected=sha(readFileSync(zip))+'  '+zip.split('/').at(-1)+'\n';
assert(line===expected,'Literal signed archive checksum differs');
verifySignature(zip+'.sha256.ed25519.sig64',checksum);
const pdf='/workspace/outputs/draft-kott-numina-pair-binding-02-final.pdf';
const pdfBytes=readFileSync(pdf);
assert(sha(pdfBytes)==='3e5db9f5ef29b7adb7ce408488b6c78cdd7121732d92efa638157de7a96f3ce9','Final PDF differs');
verifySignature(pdf+'.ed25519.sig64',pdfBytes);
const output=resolve(process.argv[2]||'/workspace/numina-production/outputs/retained-delivery-readback-2026-10-11.json');
mkdirSync(dirname(output),{recursive:true});
const report={schema:'numina.retained-delivery-readback.v1',observedAtUtc:new Date().toISOString(),
  nodeVersion:process.versions.node,publicKeySha256:publicSha256,inventorySha256,
  inventoriedFilesVerified:names.size,exactSignaturesVerified:count,signatureVerification:'passed',
  archiveSha256:sha(readFileSync(zip)),finalPdfSha256:sha(pdfBytes),
  privateKeyAccessed:false,newSignatureIssued:false,wholeProtocolVerified:false,independentStreamAcceptanceVerified:false};
writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({report:output,...report},null,2));
