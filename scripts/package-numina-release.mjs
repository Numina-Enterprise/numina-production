import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {basename,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';

// Preserve the existing final build/manifest hashes; packaging must not repin release artifacts.
const pkg=JSON.parse(readFileSync('package.json','utf8'));
const finalBuildPath='public/final-build.json';
const finalBuildBytes=readFileSync(finalBuildPath);
const finalManifestPath='public/final-manifest.json';
const finalManifestBytes=readFileSync(finalManifestPath);
const finalManifest=JSON.parse(finalManifestBytes);
const finalBuildSha256=createHash('sha256').update(finalBuildBytes).digest('hex');
const finalManifestSha256=createHash('sha256').update(finalManifestBytes).digest('hex');
if(finalBuildSha256!==pkg.numina?.finalBuildManifest?.currentContentSha256)throw Error('Current FINAL build content SHA-256 mismatch');
if(pkg.numina?.finalBuildManifest?.sha256!=='996f0ce7cc8cc5809969c6aaf5188d5c3a9a6332dbe5fd231cca974152a115fa')throw Error('Immutable FINAL build release hash changed');
if(pkg.numina?.finalManifest?.sha256!=='c9300f87f0ccfe1f2e2e132ecfa9e5de9a23f144dcdfa682849fe6f7bcc09b63')throw Error('Immutable FINAL manifest release hash changed');
execFileSync(process.execPath,['scripts/check-final-build.mjs'],{stdio:'inherit'});
execFileSync(process.execPath,['scripts/check-final-manifest.mjs'],{stdio:'inherit'});
const finalBuild=JSON.parse(finalBuildBytes);
if(finalBuild.schema!=='numina.final-build.v1'||finalBuild.identity!=='NUMINA'||finalBuild.status!=='FINAL')throw Error('Invalid FINAL NUMINA build manifest');
if(finalBuild.applicationVersion!==pkg.version)throw Error('FINAL build manifest version differs from package version');
if(finalBuild.buildModel?.finalCount!==1||finalBuild.buildModel?.finalIdentity!=='NUMINA'||finalBuild.buildModel?.canonicalHeadIdentity!=='NUMINA'||finalBuild.manifestContract?.schema!=='numina.final-build.contract.v2'||finalBuild.manifestContract?.finalAll!=='NUMINA'||finalBuild.manifestContract?.singular!==true)throw Error('Preserved FINAL NUMINA build manifest identity model mismatch');
const archive=resolve(process.argv[2]||`numina-release-v${pkg.version}.tar.gz`);
const required=['dist/client','dist/server/index.js','dist/client/downloads/application-release-v4.json'];
for(const path of required)if(!existsSync(path))throw Error('Missing NUMINA build output: '+path);

const release={
  schema:'numina.release.v1',
  identity:'NUMINA',
  repository:'NUMINA',
  database:'NUMINA',
  storage:'NUMINA',
  journal:'NUMINA',
  build:'NUMINA',
  release:'NUMINA',
  deployment:'NUMINA',
  evidence:'NUMINA',
  provenance:'NUMINA',
  version:pkg.version,
  sourceRevision:process.env.NUMINA_SOURCE_REVISION||null,
  sourceRef:process.env.NUMINA_SOURCE_REF||'main',
  externalConfirmation:'evidence-required',
  scope:'NUMINA',structure:'NUMINA',appliesTo:'NUMINA',contract:'NUMINA',singular:true,
  finalManifest:{path:finalManifestPath,sha256:finalManifestSha256,identity:'NUMINA',scope:'NUMINA',structure:'NUMINA',appliesTo:'NUMINA',contract:'NUMINA',singular:true,status:'FINAL',universal:true},
  finalBuildManifest:{path:finalBuildPath,sha256:finalBuildSha256,identity:'NUMINA',scope:'NUMINA',structure:'NUMINA',appliesTo:'NUMINA',contract:'NUMINA',singular:true,status:finalBuild.status,version:finalBuild.applicationVersion,universal:true},
  frontierId:finalManifest.frontierId
};
const releaseRecordPath='dist/NUMINA-RELEASE.json';
writeFileSync(releaseRecordPath,JSON.stringify(release,null,2)+'\n');
try{
  execFileSync('tar',['-czf',archive,'dist/client','dist/server',releaseRecordPath],{stdio:'inherit'});
}finally{
  if(existsSync(releaseRecordPath))unlinkSync(releaseRecordPath);
}
const digest=createHash('sha256').update(readFileSync(archive)).digest('hex');
writeFileSync(archive+'.sha256',digest+'  '+basename(archive)+'\n');
console.log(JSON.stringify({identity:'NUMINA',archive:basename(archive),sha256:digest,version:pkg.version}));
