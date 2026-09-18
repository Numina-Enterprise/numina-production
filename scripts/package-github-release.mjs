import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {basename,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';

const pkg=JSON.parse(readFileSync('package.json','utf8'));
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
  externalConfirmation:'evidence-required'
};
writeFileSync('dist/NUMINA-RELEASE.json',JSON.stringify(release,null,2)+'\n');
execFileSync('tar',['-czf',archive,'dist/client','dist/server','dist/NUMINA-RELEASE.json'],{stdio:'inherit'});
const digest=createHash('sha256').update(readFileSync(archive)).digest('hex');
writeFileSync(archive+'.sha256',digest+'  '+basename(archive)+'\n');
console.log(JSON.stringify({identity:'NUMINA',archive:basename(archive),sha256:digest,version:pkg.version}));
