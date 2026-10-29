import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {evidenceReleaseTag,publishEvidence,sha256Hex} from '../scripts/publish-github-evidence.mjs';

test('GitHub evidence publisher uses a commit-bound release and verifies read-back bytes',async()=>{
  const sourceCommit='a'.repeat(40),repository='skott34-dot/numina-production',token='test-token';
  const dir=mkdtempSync(join(tmpdir(),'numina-evidence-'));
  try{
    const file=join(dir,'provider-observation-1-1.json'),bytes=Buffer.from('{"identity":"NUMINA"}\n');
    writeFileSync(file,bytes);
    let release=null,nextAsset=1;
    const assets=new Map();
    const fetchFn=async(url,options={})=>{
      const method=options.method||'GET';
      if(url.endsWith('/releases/tags/'+evidenceReleaseTag(sourceCommit))&&method==='GET'){
        if(!release)return new Response('',{status:404});
        return Response.json(release);
      }
      if(url.endsWith('/releases')&&method==='POST'){
        const body=JSON.parse(options.body);
        release={id:99,tag_name:body.tag_name,target_commitish:body.target_commitish,draft:false,prerelease:false,upload_url:'https://uploads.github.test/assets{?name,label}',assets:[]};
        return Response.json(release,{status:201});
      }
      if(url.startsWith('https://uploads.github.test/assets?name=')&&method==='POST'){
        const name=decodeURIComponent(new URL(url).searchParams.get('name'));
        const body=Buffer.from(options.body),id=nextAsset++;
        const asset={id,name,size:body.length,digest:'sha256:'+sha256Hex(body),url:'https://api.github.test/assets/'+id,browser_download_url:'https://github.test/download/'+name};
        assets.set(id,body);release.assets.push(asset);
        return Response.json(asset,{status:201});
      }
      if(url.startsWith('https://api.github.test/assets/')&&method==='GET'){
        const id=Number(url.split('/').pop()),body=assets.get(id);
        return new Response(body,{status:200,headers:{'content-type':'application/octet-stream'}});
      }
      throw Error('Unexpected request '+method+' '+url);
    };
    const receipt=await publishEvidence({token,repository,sourceCommit,files:[file],fetchFn,runId:'1',runAttempt:'1'});
    assert.equal(receipt.tag,'numina-evidence-'+sourceCommit.slice(0,12));
    assert.equal(receipt.sourceCommit,sourceCommit);
    assert.equal(receipt.sha256ReadBackVerified,true);
    assert.equal(receipt.assets.length,1);
    assert.equal(receipt.assets[0].sha256,sha256Hex(bytes));
    assert.equal(receipt.assets[0].readBackVerified,true);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
