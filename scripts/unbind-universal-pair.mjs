import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const write=(p,v)=>writeFileSync(p,JSON.stringify(v,null,2)+'\n');
const genesis=read('runtime/nusd/deployment-receipt.json');
const anchor='0xea95dac2ad854c835bc526d6be70a5a4614ccd47412a4bc710308b41010b53e1';
if(!JSON.stringify(genesis).includes(anchor))throw Error('Genesis source does not match');
const oldIds=new Set(['3d5713a395933beb2efcb0e01ea47d6c0a530a5ab2719b873a0af3a506c6886c','0a8d4f1faccc8f93a33c98576c8604aa24b70f8ab2781ccfa07da995d4b5eb52']);
const gate={status:'UNBOUND',bound:false,regenerationRequired:true,productionDeploymentAllowed:false,genesisHash:anchor,genesisSource:'runtime/nusd/deployment-receipt.json',reason:'Universal pair must be regenerated from the production build; only the network genesis hash is retained as a fixed anchor.'};
function clear(v){
 if(Array.isArray(v))return v.map(clear);
 if(!v||typeof v!=='object')return oldIds.has(v)?null:v;
 const out={};
 for(const [k,val] of Object.entries(v)){
  if(['universalPairBuilds','universalPairSources','bindings','members','sourceIds','derivedHashIds','sourceIdSources'].includes(k))out[k]=[];
  else if(['universalPairBuildCount','bindingCount','sourceCount','sourceIdCount','memberCount','idCount'].includes(k))out[k]=0;
  else if(['idMirrorsSourceIds','derivedHashIdsMirrorSourceIds','everyCellReceivesBothFiles'].includes(k))out[k]=false;
  else if(k==='invariant'&&val?.scope==='UNIVERSAL_PAIR_2X2')out[k]={...val,enforced:false,bindingCount:0,status:'UNBOUND'};
  else if(k==='universalPair')out[k]={schema:val.schema,identity:'NUMINA',...gate,members:[],bindings:[],sourceIds:[],derivedHashIds:[],bindingCount:0};
  else if(Array.isArray(val)&&val.some(x=>oldIds.has(x)))out[k]=[];
  else out[k]=clear(val);
 }
 if(oldIds.has(v.runtimeId)){out.status='REGENERATION_REQUIRED';out.productionDeploymentAllowed=false;}
 return out;
}
for(const p of ['public/final-build.json','public/final-manifest.json','public/current-environments.json']){
 const v=clear(read(p));v.productionBinding=gate;
 if(p.endsWith('current-environments.json')){v.status='UNBOUND';v.bindingCount=0;}
 write(p,v);
}
const bytes=readFileSync('public/final-build.json');
const sha=createHash('sha256').update(bytes).digest('hex');
const blob=createHash('sha1').update(Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes])).digest('hex');
const manifest=read('public/final-manifest.json');manifest.frontierId=sha;manifest.canonicalSha256=sha;write('public/final-manifest.json',manifest);
const env=read('public/current-environments.json');env.frontierId=sha;env.contentHashes={finalBuildSha256:sha,finalManifestSha256:createHash('sha256').update(readFileSync('public/final-manifest.json')).digest('hex')};write('public/current-environments.json',env);
write('docs/NUMINA-FINAL-BUILD.json',read('public/final-build.json'));write('docs/NUMINA-FINAL-MANIFEST.json',manifest);
const pkg=read('package.json');const prior=pkg.numina.finalBuildManifest.blob;pkg.numina.finalBuildManifest.blob=blob;write('package.json',pkg);
for(const p of ['scripts/build.mjs','scripts/package-github-release.mjs','.github/workflows/numina.yml'])writeFileSync(p,readFileSync(p,'utf8').replaceAll(prior,blob));
console.log('Universal pair unbound; production regeneration required; genesis preserved.');
