import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,copyFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,dirname,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {inspectPlayReadiness,releaseBlockers} from '../scripts/check-play-readiness.mjs';
import worker from '../src/worker.js';

const root=fileURLToPath(new URL('../',import.meta.url));
test('published control and release records bind the same security document and surface inventory',async()=>{
  const digest=path=>createHash('sha256').update(readFileSync(resolve(root,path))).digest('hex');
  const alignment=JSON.parse(readFileSync(resolve(root,'dist/client/source-alignment.json')));
  const release=JSON.parse(readFileSync(resolve(root,'dist/client/downloads/release.json')));
  assert.deepEqual(release.security,alignment.security);
  assert.equal(release.security.sha256,digest('dist/client/downloads/Numina-Security.md'));
  assert.equal(release.security.surfacesSha256,digest('dist/client/security-surfaces.json'));
  assert.equal(release.security.sha256,digest('docs/Numina-Security.md'));
  assert.equal(release.security.surfacesSha256,digest('public/security-surfaces.json'));
  const response=await worker.fetch(new Request('https://numina.test/api/control/v2/manifest'),{NUMINA_TELEMETRY_LOGS:'false'});
  assert.equal(response.status,200);
  const manifest=await response.json();
  assert.equal(manifest.security.controlModel,release.security.controlModel);
  assert.equal(manifest.security.surfaces,release.security.surfaces);
  const surfaces=JSON.parse(readFileSync(resolve(root,'public/security-surfaces.json')));
  assert.equal(surfaces.rootCount,1);
  assert.equal(surfaces.canonicalTreasury,manifest.treasury);
  assert.ok(surfaces.surfaces.every(surface=>surface.connectionVerification==='not_established_by_this_record'));
});
const record=JSON.parse(readFileSync(resolve(root,'config/play-ignite-evidence.json'),'utf8'));
const files=['package.json','mobile/android/app/build.gradle','mobile/android/app/src/main/AndroidManifest.xml','public/.well-known/assetlinks.json','public/app.html','public/privacy.html',record.candidate.signatureEvidence];
function fixture(run){
  const base=resolve(tmpdir()),directory=mkdtempSync(resolve(base,'numina-play-'));
  try{for(const file of files){mkdirSync(dirname(resolve(directory,file)),{recursive:true});copyFileSync(resolve(root,file),resolve(directory,file));}return run(directory);}
  finally{assert.ok(directory.startsWith(base+sep));rmSync(directory,{recursive:true,force:true});}
}
function change(directory,path,before,after){const target=resolve(directory,path),text=readFileSync(target,'utf8');assert.ok(text.includes(before));writeFileSync(target,text.replace(before,after));}

test('source safeguards and historical AAB binding do not claim Play readiness',()=>{
  const result=inspectPlayReadiness(root,record);
  assert.equal(result.sourceChecksPassed,true,JSON.stringify(result.checks));
  assert.equal(result.readyForSubmission,false);
  assert.equal(result.rolloutComplete,false);
  assert.equal(result.sourceVersion,'4.0.0');
  assert.equal(result.candidateVersion,'3.0.0');
  assert.equal(result.submissionBlockers.length,8);
  assert.equal(result.completionBlockers.length,3);
});
test('submission readiness does not require publication or a Play-installed device beforehand',()=>{
  const copy=structuredClone(record);
  for(const id of ['upload','playValidation','storeListing','appContent','reviewerAccess','financialScope','dataSafety','billingClassification'])copy.gates[id]={status:'confirmed',evidence:'Test fixture only'};
  const result=inspectPlayReadiness(root,copy);
  assert.equal(result.readyForSubmission,true);
  assert.equal(result.rolloutComplete,false);
  assert.equal(result.completionBlockers.length,3);
});
test('missing, draft and evidence-free gates cannot become confirmed by omission',()=>{
  assert.equal(releaseBlockers({}).length,11);
  for(const status of ['saved','passed','unknown','confirmed']){
    const copy=structuredClone(record);for(const gate of Object.values(copy.gates)){gate.status=status;delete gate.evidence;}
    assert.equal(releaseBlockers(copy).length,11);
  }
});
test('source drift rejects wrong package, old target SDK and new sensitive permission',()=>{
  for(const [path,before,after,id] of [
    ['mobile/android/app/build.gradle',"applicationId 'xyz.numinalabs.app'","applicationId 'xyz.other.app'",'package'],
    ['mobile/android/app/build.gradle','targetSdk 36','targetSdk 35','target-api'],
    ['mobile/android/app/src/main/AndroidManifest.xml','<application','<uses-permission android:name="android.permission.READ_CALL_LOG" />\n<application','permissions']
  ])fixture(directory=>{change(directory,path,before,after);const result=inspectPlayReadiness(directory,record);assert.equal(result.sourceChecksPassed,false);assert.equal(result.checks.find(check=>check.id===id).status,'failed');});
});
test('upload certificate cannot substitute for Play app-signing association',()=>fixture(directory=>{
  change(directory,'public/.well-known/assetlinks.json',record.playAppSigningSha256,'25:9B:B2:40:F5:74:EB:DA:4F:0E:F9:09:32:9C:06:C3:85:42:86:31:5F:08:05:CB:84:31:2B:5F:94:00:41:34');
  assert.equal(inspectPlayReadiness(directory,record).checks.find(check=>check.id==='play-association-source').status,'failed');
}));
test('a different AAB fails byte verification even when its filename matches',()=>fixture(directory=>{
  const aab=resolve(directory,record.candidate.file);writeFileSync(aab,'not the signed release');
  assert.equal(inspectPlayReadiness(directory,record,{aabPath:aab}).checks.find(check=>check.id==='candidate-bytes').status,'failed');
}));
test('release command fails while source-only command passes and unknown flags fail closed',()=>{
  const script=resolve(root,'scripts/check-play-readiness.mjs');
  for(const [args,status] of [[[],1],[['--source-only'],0],[['--bogus'],1],[['--aab'],1]])assert.equal(spawnSync(process.execPath,[script,...args],{encoding:'utf8'}).status,status);
});
test('public deletion request path works without account or storage and keeps security headers',async()=>{
  const response=await worker.fetch(new Request('https://numina.test/privacy'),{
    NUMINA_TELEMETRY_LOGS:'false',
    get DB(){throw Error('Deletion instructions must not require account storage');},
    ASSETS:{fetch(req){
      assert.equal(new URL(req.url).pathname,'/privacy');
      return new Response(readFileSync(resolve(root,'public/privacy.html')),{headers:{'Content-Type':'text/html'}});
    }}
  });
  assert.equal(response.status,200);assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
  const html=await response.text();assert.match(html,/id="delete-account"/);assert.match(html,/mailto:skott34@numinalabs.xyz\?subject=Delete%20my%20Numina%20account/);
  assert.match(html,/without installing the app or signing in/);assert.match(html,/does not instantly delete records/);
});
