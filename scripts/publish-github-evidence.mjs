import {createHash} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {basename,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const API_VERSION='2022-11-28';
const EXPECTED_REPOSITORY='skott34-dot/numina-production';

export const sha256Hex=value=>createHash('sha256').update(value).digest('hex');

export function evidenceReleaseTag(sourceCommit){
  if(!/^[0-9a-f]{40}$/i.test(String(sourceCommit||'')))throw Error('GITHUB_SHA is required');
  return 'numina-evidence-'+sourceCommit.slice(0,12).toLowerCase();
}

function headers(token,accept='application/vnd.github+json'){
  return {
    authorization:'Bearer '+token,
    accept,
    'x-github-api-version':API_VERSION,
    'user-agent':'NUMINA-evidence-release'
  };
}

async function readJson(response,label){
  const text=await response.text();
  let parsed=null;
  if(text){try{parsed=JSON.parse(text);}catch{parsed=text;}}
  if(!response.ok)throw Error(label+' '+response.status+': '+(typeof parsed==='string'?parsed:JSON.stringify(parsed)));
  return parsed;
}

async function readBackAsset({asset,token,fetchFn}){
  const response=await fetchFn(asset.url,{
    headers:headers(token,'application/octet-stream'),
    redirect:'follow'
  });
  if(!response.ok)throw Error('GitHub evidence read-back failed '+response.status+' for '+asset.name);
  const bytes=Buffer.from(await response.arrayBuffer());
  return {bytes,digest:sha256Hex(bytes)};
}

export async function publishEvidence({token,repository,sourceCommit,files,fetchFn=fetch,runId='',runAttempt=''}) {
  if(!token)throw Error('GITHUB_TOKEN is required');
  if(repository!==EXPECTED_REPOSITORY)throw Error('Unexpected repository');
  if(!Array.isArray(files)||files.length===0)throw Error('At least one evidence file is required');
  for(const file of files)if(!existsSync(file))throw Error('Missing evidence file: '+file);

  const tag=evidenceReleaseTag(sourceCommit);
  const base='https://api.github.com/repos/'+repository;
  const lookup=await fetchFn(base+'/releases/tags/'+encodeURIComponent(tag),{headers:headers(token)});
  let release;
  if(lookup.status===404){
    release=await readJson(await fetchFn(base+'/releases',{
      method:'POST',
      headers:{...headers(token),'content-type':'application/json'},
      body:JSON.stringify({
        tag_name:tag,
        target_commitish:sourceCommit,
        name:'NUMINA Evidence '+sourceCommit.slice(0,12),
        body:[
          'Canonical NUMINA evidence release.',
          '',
          'Source commit: `'+sourceCommit+'`',
          'Persistence: GitHub Release assets with SHA-256 read-back verification.'
        ].join('\n'),
        draft:false,
        prerelease:false,
        generate_release_notes:false
      })
    }),'GitHub evidence release create failed');
  }else{
    release=await readJson(lookup,'GitHub evidence release lookup failed');
  }

  if(release.draft||release.prerelease)throw Error('GitHub evidence release is not final');
  if(String(release.tag_name)!==tag)throw Error('GitHub evidence release tag mismatch');
  if(String(release.target_commitish).toLowerCase()!==sourceCommit.toLowerCase())throw Error('GitHub evidence release target mismatch');

  const uploadBase=String(release.upload_url||'').replace(/\{.*$/,'');
  if(!uploadBase)throw Error('GitHub evidence release upload URL missing');
  const existing=new Map((release.assets||[]).map(asset=>[asset.name,asset]));
  const verified=[];

  for(const file of files){
    const bytes=readFileSync(file);
    const name=basename(file);
    const digest=sha256Hex(bytes);
    let asset=existing.get(name);
    if(asset){
      if(asset.size!==bytes.length)throw Error('Existing GitHub evidence asset size mismatch: '+name);
      if(asset.digest&&asset.digest!=='sha256:'+digest)throw Error('Existing GitHub evidence asset digest mismatch: '+name);
    }else{
      asset=await readJson(await fetchFn(uploadBase+'?name='+encodeURIComponent(name),{
        method:'POST',
        headers:{
          ...headers(token),
          'content-type':name.endsWith('.json')?'application/json; charset=utf-8':'application/octet-stream',
          'content-length':String(bytes.length)
        },
        body:bytes
      }),'GitHub evidence asset upload failed');
    }

    const readBack=await readBackAsset({asset,token,fetchFn});
    if(readBack.bytes.length!==bytes.length)throw Error('GitHub evidence read-back size mismatch: '+name);
    if(readBack.digest!==digest)throw Error('GitHub evidence read-back SHA-256 mismatch: '+name);
    if(asset.digest&&asset.digest!=='sha256:'+digest)throw Error('GitHub evidence API digest mismatch: '+name);
    verified.push({name,size:bytes.length,sha256:digest,assetId:asset.id,url:asset.browser_download_url||null,readBackVerified:true});
  }

  return {
    schema:'numina.github-evidence-release.v1',
    identity:'NUMINA',
    repository,
    sourceCommit,
    releaseId:release.id,
    tag,
    runId:String(runId||''),
    runAttempt:String(runAttempt||''),
    persistence:'github_release_assets',
    sha256ReadBackVerified:true,
    assets:verified
  };
}

async function main(){
  const token=process.env.GITHUB_TOKEN;
  const repository=process.env.GITHUB_REPOSITORY;
  const sourceCommit=process.env.GITHUB_SHA;
  const files=process.argv.slice(2).map(path=>resolve(path));
  const receipt=await publishEvidence({
    token,
    repository,
    sourceCommit,
    files,
    runId:process.env.GITHUB_RUN_ID,
    runAttempt:process.env.GITHUB_RUN_ATTEMPT
  });
  process.stdout.write(JSON.stringify(receipt,null,2)+'\n');
}

const invoked=process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href;
if(invoked)main().catch(error=>{console.error(error?.stack||String(error));process.exitCode=1;});
