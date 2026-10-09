import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {basename,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';

const pkg=JSON.parse(readFileSync('package.json','utf8'));
const finalBuildPath='public/final-build.json';
const FINAL_BUILD_MANIFEST_BLOB=pkg.numina?.finalBuildManifest?.blob;
if(!/^[0-9a-f]{40}$/i.test(String(FINAL_BUILD_MANIFEST_BLOB||'')))throw Error('Preserved FINAL build manifest blob missing');
const finalBuildBytes=readFileSync(finalBuildPath);
const finalBuildBlob=createHash('sha1').update(Buffer.concat([Buffer.from('blob '+finalBuildBytes.length+'\0'),finalBuildBytes])).digest('hex');
if(finalBuildBlob!==FINAL_BUILD_MANIFEST_BLOB)throw Error('FINAL build manifest blob mismatch');
execFileSync(process.execPath,['scripts/check-final-build.mjs'],{stdio:'inherit'});
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
  sourceCommit:process.env.GITHUB_SHA||null,
  externalConfirmation:'evidence-required',
  finalBuildManifest:{path:finalBuildPath,blob:FINAL_BUILD_MANIFEST_BLOB,sha256:createHash('sha256').update(finalBuildBytes).digest('hex'),identity:finalBuild.identity,status:finalBuild.status,version:finalBuild.applicationVersion}
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
