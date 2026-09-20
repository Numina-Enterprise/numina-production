import {createHash} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';

const token=process.env.GITHUB_TOKEN;
const repository=process.env.GITHUB_REPOSITORY;
const sourceCommit=process.env.GITHUB_SHA;
if(!token)throw Error('GITHUB_TOKEN is required');
if(repository!=='skott34-dot/numina-production')throw Error('Unexpected repository');
if(!/^[0-9a-f]{40}$/i.test(sourceCommit||''))throw Error('GITHUB_SHA is required');

const pkg=JSON.parse(readFileSync('package.json','utf8'));
const version=pkg.version;
const tag='v'+version;
const archive=`numina-release-v${version}.tar.gz`;
const checksum=archive+'.sha256';
for(const path of [archive,checksum])if(!existsSync(path))throw Error('Missing release asset: '+path);

const checksumText=readFileSync(checksum,'utf8').trim();
const expectedDigest=checksumText.split(/\s+/)[0];
const actualDigest=createHash('sha256').update(readFileSync(archive)).digest('hex');
if(expectedDigest!==actualDigest)throw Error('Release archive checksum mismatch');

const headers={
  authorization:'Bearer '+token,
  accept:'application/vnd.github+json',
  'x-github-api-version':'2022-11-28',
  'user-agent':'NUMINA-release'
};
const base='https://api.github.com/repos/'+repository;

async function json(url,options={}){
  const response=await fetch(url,{...options,headers:{...headers,...(options.headers||{})}});
  const body=await response.text();
  let parsed=null;
  if(body){try{parsed=JSON.parse(body);}catch{parsed=body;}}
  if(!response.ok)throw Error(`GitHub API ${response.status}: ${typeof parsed==='string'?parsed:JSON.stringify(parsed)}`);
  return parsed;
}

let release;
const existingResponse=await fetch(base+'/releases/tags/'+encodeURIComponent(tag),{headers});
if(existingResponse.status===404){
  release=await json(base+'/releases',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({
      tag_name:tag,
      target_commitish:sourceCommit,
      name:'NUMINA '+tag,
      body:[
        'Canonical NUMINA GitHub Release.',
        '',
        'Source commit: `'+sourceCommit+'`',
        'Archive SHA-256: `'+actualDigest+'`'
      ].join('\n'),
      draft:false,
      prerelease:false,
      generate_release_notes:false
    })
  });
}else{
  const body=await existingResponse.text();
  if(!existingResponse.ok)throw Error('GitHub release lookup failed: '+existingResponse.status+' '+body);
  release=JSON.parse(body);
  if(release.draft||release.prerelease)throw Error('Existing release is not final');
  if(release.target_commitish!==sourceCommit){
    if(!/^[0-9a-f]{40}$/i.test(String(release.target_commitish||'')))throw Error('Existing release target is not an immutable commit SHA');
    const historicalAssets=new Map((release.assets||[]).map(asset=>[asset.name,asset]));
    for(const path of [archive,checksum])if(!historicalAssets.has(path))throw Error('Historical release is missing canonical asset: '+path);
    const historicalArchive=historicalAssets.get(archive);
    const historicalDigest=typeof historicalArchive.digest==='string'&&historicalArchive.digest.startsWith('sha256:')
      ?historicalArchive.digest.slice('sha256:'.length)
      :null;
    console.log(JSON.stringify({
      identity:'NUMINA',
      status:'existing_release_preserved',
      releaseId:release.id,
      tag:release.tag_name,
      targetCommit:release.target_commitish,
      currentSourceCommit:sourceCommit,
      archive,
      sha256:historicalDigest,
      assets:[archive,checksum],
      htmlUrl:release.html_url
    }));
    process.exit(0);
  }
}

const existingAssets=new Map((release.assets||[]).map(asset=>[asset.name,asset]));
for(const path of [archive,checksum]){
  const bytes=readFileSync(path);
  const digest='sha256:'+createHash('sha256').update(bytes).digest('hex');
  const existing=existingAssets.get(path);
  if(existing){
    if(existing.size!==bytes.length)throw Error('Existing release asset size mismatch: '+path);
    if(existing.digest&&existing.digest!==digest)throw Error('Existing release asset digest mismatch: '+path);
    continue;
  }
  const uploadBase=String(release.upload_url||'').replace(/\{.*$/,'');
  if(!uploadBase)throw Error('Release upload URL missing');
  const response=await fetch(uploadBase+'?name='+encodeURIComponent(path),{
    method:'POST',
    headers:{
      ...headers,
      'content-type':path.endsWith('.sha256')?'text/plain; charset=utf-8':'application/gzip',
      'content-length':String(bytes.length)
    },
    body:bytes
  });
  const body=await response.text();
  if(!response.ok)throw Error('Release asset upload failed '+response.status+': '+body);
}

const verified=await json(base+'/releases/tags/'+encodeURIComponent(tag));
const names=new Set((verified.assets||[]).map(asset=>asset.name));
for(const path of [archive,checksum])if(!names.has(path))throw Error('Published release is missing asset: '+path);
console.log(JSON.stringify({
  identity:'NUMINA',
  status:'release_published_or_verified',
  releaseId:verified.id,
  tag:verified.tag_name,
  targetCommit:verified.target_commitish,
  archive,
  sha256:actualDigest,
  assets:[archive,checksum],
  htmlUrl:verified.html_url
}));
