import {readFileSync,writeFileSync,readdirSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

export function syncApplicationReleasePin({write=false}={}){
  const version=JSON.parse(readFileSync(path.join(root,'package.json'))).version,major=version.split('.')[0];
  const aliases=['release.json',...new Set(['2','3',major])].map(name=>name==='release.json'?name:'application-release-v'+name+'.json');
  const excluded=new Set(aliases.map(name=>'client/downloads/'+name));
  const release=JSON.parse(readFileSync(path.join(root,'dist/client/downloads/application-release-v'+major+'.json')));
  const collect=(relative='')=>readdirSync(path.join(root,'dist',relative)).flatMap(name=>{
    const file=relative?relative+'/'+name:name,absolute=path.join(root,'dist',file),metadata=lstatSync(absolute);
    if(metadata.isSymbolicLink())throw Error('Application inventory contains a symbolic link: '+file);
    if(metadata.isDirectory())return collect(file);
    if(!metadata.isFile())throw Error('Invalid application artifact: '+file);
    return excluded.has(file)?[]:[{path:file,sha256:digest(readFileSync(absolute))}];
  });
  const artifacts=collect().sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  const buildId=digest(artifacts.map(({path,sha256})=>sha256+'  '+path+'\n').join(''));
  if(release.schema!=='numina.application-release.v2'||release.version!==version||release.release!=='numina-v'+version||
    release.build_id!==buildId||JSON.stringify(release.artifacts)!==JSON.stringify(artifacts))throw Error('Generated application inventory does not match distribution bytes');
  for(const alias of aliases)if(JSON.stringify(JSON.parse(readFileSync(path.join(root,'dist/client/downloads',alias))))!==JSON.stringify(release))throw Error('Application release aliases differ');
  const contractPath=path.join(root,'src/application-release-contract.js'),source=readFileSync(contractPath,'utf8');
  const buildPin=/export const EXPECTED_APPLICATION_ARTIFACT_BUILD_ID='([a-f0-9]{64})';/;
  const clientPin=/export const EXPECTED_APPLICATION_CLIENT_SHA256='([a-f0-9]{64})';/;
  const serverPin=/export const EXPECTED_APPLICATION_SERVER_SHA256='([a-f0-9]{64})';/;
  const currentBuild=source.match(buildPin)?.[1],currentClient=source.match(clientPin)?.[1],currentServer=source.match(serverPin)?.[1];
  const clientSha=artifacts.find(file=>file.path==='client/index.html')?.sha256;
  const serverSha=artifacts.find(file=>file.path==='server/index.js')?.sha256;
  if(!currentBuild||!currentClient||!currentServer||!clientSha||!serverSha||
    !source.includes("export const APPLICATION_VERSION='"+version+"';")||
    !source.includes("export const APPLICATION_RELEASE='numina-v"+version+"';"))throw Error('Application release contract identity mismatch');
  const mismatch=currentBuild!==buildId||currentClient!==clientSha||currentServer!==serverSha;
  if(mismatch){
    if(!write)throw Error('Application release pin differs from current distribution: '+buildId);
    const updated=source
      .replace(buildPin,"export const EXPECTED_APPLICATION_ARTIFACT_BUILD_ID='"+buildId+"';")
      .replace(clientPin,"export const EXPECTED_APPLICATION_CLIENT_SHA256='"+clientSha+"';")
      .replace(serverPin,"export const EXPECTED_APPLICATION_SERVER_SHA256='"+serverSha+"';");
    writeFileSync(contractPath,updated);
  }
  return {buildId,clientSha256:clientSha,serverSha256:serverSha,artifactCount:artifacts.length,updated:write&&mismatch};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.slice(2).some(argument=>argument!=='--write'))throw Error('Usage: node scripts/sync-application-release-pin.mjs [--write]');
  console.log(JSON.stringify(syncApplicationReleasePin({write:process.argv.includes('--write')})));
}
