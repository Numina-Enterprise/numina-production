// Checks are fixed read operations. Registry data cannot choose a destination or command.
export const CONNECTION_TARGETS = Object.freeze({
  website:{name:'Website',entry:'/',path:'/',kind:'page'},
  application:{name:'Numina OS',entry:'/app',path:'/app',kind:'page'},
  services:{name:'Services',entry:'/services',path:'/services',kind:'page'},
  frontier:{name:'Frontier',entry:'/frontier',path:'/frontier',kind:'page'},
  control:{name:'Control panel',entry:'/control',path:'/control',kind:'page'},
  'application-api':{name:'Account services',entry:'/api/app/v1',path:'/api/app/v1/health',kind:'health'},
  'control-api':{name:'Control API',entry:'/api/control/v2/manifest',path:'/api/control/v2/manifest',kind:'control'},
  'mcp-discovery':{name:'Agent discovery',entry:'/api/control/v2/discovery-mcp',path:'/api/control/v2/discovery-mcp',kind:'mcp',server:'numina-discovery'},
  'mcp-operations':{name:'Agent operations',entry:'/api/control/v2/mcp',path:'/api/control/v2/mcp',kind:'mcp',server:'numina-control'},
  a2a:{name:'Agent-to-agent interface',entry:'/.well-known/agent-card.json',path:'/.well-known/agent-card.json',kind:'a2a'},
  'integration-kit':{name:'Integration kit',entry:'/integrations',path:'/downloads/integration-kit-v4.0.0-record.json',kind:'integration'},
  android:{name:'Android',entry:'/downloads/native-package-record-v4.json',path:'/downloads/native-package-record-v4.json',kind:'native'},
  ios:{name:'iOS',entry:'/downloads/native-package-record-v4.json',path:'/downloads/native-package-record-v4.json',kind:'native'},
  'runtime-verifier':{name:'Core runtime',entry:'/core',path:'/v1/status',kind:'runtime'},
  treasury:{name:'Canonical treasury',entry:'/api/control/v1/treasury',path:'/api/control/v1/treasury',kind:'treasury'},
  'provider-observations':{name:'Provider account',entry:'/api/control/v1/stripe-treasury',path:'/api/control/v1/stripe-treasury',kind:'provider'},
  'financial-status':{name:'Financial capabilities',entry:'/api/nusd/v1/status',path:'/api/nusd/v1/status',kind:'financial'},
  'financial-evidence':{name:'Financial evidence',entry:'/financial-services',path:'/api/financial/v1/manifest',kind:'evidence'},
  telemetry:{name:'Telemetry',entry:'/telemetry-metrics.json',path:'/telemetry-metrics.json',kind:'telemetry'},
  'release-evidence':{name:'Release evidence',entry:'/v4/release/manifest',path:'/v4/release/manifest',kind:'release'}
});
for(const target of Object.values(CONNECTION_TARGETS))Object.freeze(target);

export function validateConnectionManifest(value){
  if(value?.schema!=='numina.security-surfaces.v1'||value.rootCount!==1||value.authority!=='NUMINA'||value.canonicalTreasury!=='/api/control/v1/treasury'||!Array.isArray(value.surfaces)||value.surfaces.length!==Object.keys(CONNECTION_TARGETS).length)throw Error('CONNECTION_MANIFEST_INVALID');
  const seen=new Set();
  for(const surface of value.surfaces){
    const target=Object.hasOwn(CONNECTION_TARGETS,surface?.id)?CONNECTION_TARGETS[surface.id]:null;
    if(!target||seen.has(surface.id)||surface.entry!==target.entry||surface.security!=='/security')throw Error('CONNECTION_MANIFEST_INVALID');
    seen.add(surface.id);
  }
  return value;
}

function connectionClassification(target,value){
  const schema=value?.schema;
  switch(target.kind){
    case 'health':if(value?.version==='4.0.0')return value.status==='ready'?['available','Service responding','Account-service health check passed.']:['attention','Needs attention','The account service reports it is unavailable.'];break;
    case 'control':if(schema==='numina.frontier.v2'&&value.treasury==='/api/control/v1/treasury')return ['available','Interface available','The shared control manifest responds. Each operation still requires its existing authority.'];break;
    case 'mcp':if(value?.jsonrpc==='2.0'&&value.id==='numina-connection-check'&&value.result?.serverInfo?.name===target.server&&value.result.protocolVersion==='2025-11-25')return ['available','Protocol connected','The agent interface accepted a read-only initialization check. No tool was executed.'];break;
    case 'a2a':if(value?.protocolVersion==='0.3.0'&&value.name==='Numina Control')return ['available','Discovery available','The agent card responds. No agent message or operation was sent.'];break;
    case 'integration':if(schema==='numina.integration.archive.v2'&&value.version==='4.0.0'&&/^[a-f0-9]{64}$/.test(value.sha256))return ['available','Package record available','Distribution metadata responds. Installation in another product is not checked.'];break;
    case 'native':if(schema==='numina.native-package.v1'&&value.proposedPackageIdentity==='xyz.numinalabs.app')return ['available','Package record available','The existing package record responds. Device installation and store approval are separate.'];break;
    case 'runtime':if([value?.production_version,value?.release,value?.state?.release].some(version=>['1.9.0-rc26','core-v1.8+prod-v1.9.0-rc26'].includes(version)))return ['available','Runtime responding','The pinned runtime status responds. Review its signed evidence in Build & trust.'];break;
    case 'treasury':if(schema==='numina.treasury.v1')return value.status==='READY'?['available','Read connection working','The authorized canonical treasury read succeeded. No financial movement was requested.']:['attention','Not initialized','The canonical treasury reports that initialization is incomplete.'];break;
    case 'provider':if(schema==='numina.stripe.treasury.v1'&&value.connection==='read_only')return ['available','Provider read working','The authorized provider observation succeeded. No balances are included in this report.'];break;
    case 'financial':if(schema==='numina.nusd.status.v1'&&value.capabilities&&typeof value.capabilities==='object')return ['attention','Review capability status',Object.values(value.capabilities).some(flag=>flag===false)?'The application reports disabled financial capabilities. Open the current status for details.':'The application reports capability flags. This check does not verify settlement, reserves or operating authority.'];break;
    case 'evidence':if(schema==='numina.financial-evidence.v1'&&value.classification==='evidence_management_only')return ['available','Evidence workspace available','Private document registration and review tools respond. This does not attest operating authority or enable financial transactions.'];break;
    case 'telemetry':if(schema==='numina.metric-map.v1')return ['available','Definitions available','Metric definitions respond. Private operational logs are not read.'];break;
    case 'release':if(schema==='numina.application-release.v2'&&value.product==='Numina'&&/^[a-f0-9]{64}$/.test(value.build_id))return ['available','Release record available','The deployed application inventory responds. Its signature is verified separately.'];break;
  }
  return ['error','Unexpected response','The response does not match the expected Numina interface.'];
}

export async function checkConnection(id,{origin,fetchImpl=fetch,signal,timeoutMs=8000}={}){
  if(!Object.hasOwn(CONNECTION_TARGETS,id))throw Error('UNKNOWN_CONNECTION');
  const base=new URL(origin);
  if(base.username||base.password||base.pathname!=='/'||base.search||base.hash||!(base.protocol==='https:'||(base.protocol==='http:'&&['localhost','127.0.0.1'].includes(base.hostname))))throw Error('INVALID_CONNECTION_ORIGIN');
  const target=CONNECTION_TARGETS[id],started=Date.now(),controller=new AbortController();
  let timer,reader,response,abortHandler;
  const result=(state,label,message)=>({id,name:target.name,path:target.path,state,label,message,checkedAt:new Date().toISOString(),durationMs:Date.now()-started,httpStatus:response?.status||null});
  if(signal?.aborted)return result('cancelled','Cancelled','The check was cancelled.');
  const stop=()=>controller.abort();
  try{
    const deadline=new Promise((_,reject)=>{abortHandler=()=>reject(Error(signal?.aborted?'CANCELLED':'TIMEOUT'));controller.signal.addEventListener('abort',abortHandler,{once:true});timer=setTimeout(stop,timeoutMs);});
    signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();
    const request={method:target.kind==='mcp'?'POST':'GET',credentials:'same-origin',cache:'no-store',redirect:'manual',signal:controller.signal,headers:{Accept:target.kind==='page'?'text/html':'application/json'}};
    if(target.kind==='mcp'){request.headers['Content-Type']='application/json';request.body=JSON.stringify({jsonrpc:'2.0',id:'numina-connection-check',method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'numina-connections',version:'4.0.0'}}});}
    response=await Promise.race([fetchImpl(new URL(target.path,base.origin).href,request),deadline]);
    if(response.type==='opaqueredirect'||response.redirected||response.status===401||response.status===403||response.status>=300&&response.status<400)return result('access','Sign-in or access needed','Open the interface with an authorized account. No credentials are collected here.');
    if(!response.ok)return result('error',response.status===429?'Try again later':'Unavailable',response.status===429?'The service requested a slower request rate.':'The service did not accept this connection check.');
    const type=response.headers.get('content-type')||'';
    if(target.kind==='page')return type.includes('text/html')?result('available','Page available','The page responds. Authenticated workflows are checked separately.'):result('error','Unexpected response','The page did not return HTML.');
    if(!type.includes('application/json')||!response.body)return result('error','Unexpected response','The interface did not return JSON.');
    reader=response.body.getReader();const chunks=[];let size=0;
    for(;;){const next=await Promise.race([reader.read(),deadline]);if(next.done)break;size+=next.value.byteLength;if(size>1048576)return result('error','Response too large','The response exceeded the connection-check limit.');chunks.push(next.value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const classification=connectionClassification(target,JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
    return result(...classification);
  }catch(error){return result(error.message==='CANCELLED'?'cancelled':'error',error.message==='CANCELLED'?'Cancelled':controller.signal.aborted?'Timed out':'Check failed',error.message==='CANCELLED'?'The check was cancelled.':controller.signal.aborted?'The interface did not finish responding before the deadline.':'A valid response could not be read.');}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',stop);controller.signal.removeEventListener('abort',abortHandler);if(reader)void reader.cancel().catch(()=>{});else void response?.body?.cancel().catch(()=>{});}
}

export function connectionReport(results,origin){
  return {schema:'numina.connection-observations.v1',system:'Numina',rootCount:1,origin:new URL(origin).origin,recordedAt:new Date().toISOString(),scope:'Browser-session read checks; unsigned observations, not independent assurance or financial execution evidence.',financialOperationsPerformed:false,credentialsCollected:false,results:results.map(item=>({id:item.id,name:item.name,path:item.path,state:item.state,label:item.label,message:item.message,checkedAt:item.checkedAt,durationMs:item.durationMs,httpStatus:item.httpStatus}))};
}
