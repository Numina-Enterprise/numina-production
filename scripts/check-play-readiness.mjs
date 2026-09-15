import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const PACKAGE='xyz.numinalabs.app';
const REQUIRED_GATES=['upload','playValidation','storeListing','appContent','reviewerAccess','financialScope','dataSafety','billingClassification','deviceInstall','twa','closedTestPublication'];
const POST_SUBMISSION_GATES=new Set(['deviceInstall','twa','closedTestPublication']);
export function releaseBlockers(record){
  return REQUIRED_GATES.filter(id=>{
    const gate=record.gates?.[id];
    return gate?.status!=='confirmed'||typeof gate.evidence!=='string'||!gate.evidence.trim();
  }).map(id=>({id,detail:record.gates?.[id]?.detail||'No confirmed evidence recorded.'}));
}
export function inspectPlayReadiness(root,record,{aabPath}={}){
  const read=path=>readFileSync(resolve(root,path),'utf8');
  const gradle=read('mobile/android/app/build.gradle');
  const manifest=read('mobile/android/app/src/main/AndroidManifest.xml');
  const cleanManifest=manifest.replace(/<!--[\s\S]*?-->/g,'');
  const cleanGradle=gradle.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
  const checks=[];
  const check=(id,ok,detail)=>checks.push({id,status:ok?'passed':'failed',detail});
  check('package',record.packageName===PACKAGE&&['namespace','applicationId'].every(key=>cleanGradle.match(new RegExp('\\b'+key+'\\s+[\'\"]([^\'\"]+)[\'\"]'))?.[1]===PACKAGE),'Preserve the registered package and Android namespace.');
  const target=Number(cleanGradle.match(/\btargetSdk\s+(\d+)/)?.[1]);
  check('target-api',Number.isInteger(target)&&target>=36,`Current Android source targetSdk=${target}; this does not validate the uploaded bundle.`);
  const permissions=[...cleanManifest.matchAll(/<uses-permission(?:-sdk-\d+)?\b[^>]*android:name=["']([^"']+)["']/g)].map(match=>match[1]);
  check('permissions',permissions.length===1&&permissions[0]==='android.permission.INTERNET','Reviewed TWA source allowlist: INTERNET only. Any new permission needs a new policy review; merged bundle still requires validation.');
  check('transport',/android:usesCleartextTraffic="false"/.test(cleanManifest)&&/android:allowBackup="false"/.test(cleanManifest),'Cleartext traffic and Android backup remain disabled.');
  check('launch-url',cleanManifest.includes('android:name="android.support.customtabs.trusted.DEFAULT_URL" android:value="https://numinalabs.xyz/app"'),'Keep the existing Numina hosted entry point.');
  const associations=JSON.parse(read('public/.well-known/assetlinks.json'));
  check('play-association-source',/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/.test(record.playAppSigningSha256||'')&&associations.some(item=>item.relation?.includes('delegate_permission/common.handle_all_urls')&&item.target?.namespace==='android_app'&&item.target?.package_name===PACKAGE&&item.target.sha256_cert_fingerprints?.includes(record.playAppSigningSha256)),'Published source includes the Play Console app-signing fingerprint. Live HTTPS and device checks are separate.');
  const app=read('public/app.html'),privacy=read('public/privacy.html');
  check('deletion-path',app.includes('href="/privacy#delete-account"')&&privacy.includes('id="delete-account"')&&privacy.includes('mailto:skott34@numinalabs.xyz?subject=Delete%20my%20Numina%20account'),'Account deletion is discoverable from the app and the public privacy page. This does not verify fulfillment.');
  const signedRecord=JSON.parse(read(record.candidate.signatureEvidence));
  const signedArtifact=signedRecord.artifacts.find(item=>item.file===record.candidate.file);
  check('candidate-record',signedRecord.packageIdentity===PACKAGE&&signedRecord.sourceCommit===record.candidate.sourceCommit&&signedArtifact?.sha256===record.candidate.sha256&&signedArtifact?.bytes===record.candidate.bytes,'Candidate remains bound to the historical signed-build record, separately from current hosted source.');
  if(aabPath){const bytes=readFileSync(aabPath);check('candidate-bytes',bytes.length===record.candidate.bytes&&createHash('sha256').update(bytes).digest('hex')===record.candidate.sha256,'Supplied AAB bytes match the recorded candidate. No signature or Play acceptance is inferred.');}
  const blockers=releaseBlockers(record);
  const sourceChecksPassed=checks.every(item=>item.status==='passed');
  const submissionBlockers=blockers.filter(item=>!POST_SUBMISSION_GATES.has(item.id));
  return {schema:'numina.play-readiness.v1',observedDate:record.observedDate,packageName:PACKAGE,sourceVersion:JSON.parse(read('package.json')).version,candidateVersion:record.candidate.versionName,scope:'Local source checks and recorded observations; not a live Play policy certification.',checks,submissionBlockers,completionBlockers:blockers.filter(item=>POST_SUBMISSION_GATES.has(item.id)),sourceChecksPassed,readyForSubmission:sourceChecksPassed&&submissionBlockers.length===0,rolloutComplete:sourceChecksPassed&&blockers.length===0};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const root=fileURLToPath(new URL('../',import.meta.url)),args=process.argv.slice(2);
    let aabPath;
    for(let index=0;index<args.length;index++){
      if(args[index]==='--source-only')continue;
      if(args[index]==='--aab'&&args[index+1]&&!args[index+1].startsWith('--')&&!aabPath){aabPath=resolve(args[++index]);continue;}
      throw Error('Usage: node scripts/check-play-readiness.mjs [--source-only] [--aab PATH]');
    }
    const record=JSON.parse(readFileSync(resolve(root,'config/play-ignite-evidence.json'),'utf8'));
    const result=inspectPlayReadiness(root,record,{aabPath});
    console.log(JSON.stringify(result,null,2));
    process.exitCode=(args.includes('--source-only')?result.sourceChecksPassed:result.readyForSubmission)?0:1;
  }catch(error){console.error('Play readiness check failed: '+error.message);process.exitCode=1;}
}
