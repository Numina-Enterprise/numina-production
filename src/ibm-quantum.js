// Copyright © 2026 SK Consulting LLC. Numina™. See OWNERSHIP.md.
// Authenticated device discovery only. No job submissions or treasury writes.
export const IBM_QUANTUM_API_VERSION='2026-04-15';
const IBM_QUANTUM_ORIGINS=Object.freeze({'us-east':'https://quantum.cloud.ibm.com','eu-de':'https://eu-de.quantum.cloud.ibm.com'});
const IBM_QUANTUM_BACKEND_NAME=/^[A-Za-z0-9_.-]{1,255}$/;
export function ibmQuantumConfiguration(env={}) {
  const required=['NUMINA_IBM_QUANTUM_API_KEY','NUMINA_IBM_QUANTUM_INSTANCE_CRN'];
  const missing=required.filter(key=>typeof env[key]!=='string'||!env[key].trim());
  const parts=String(env.NUMINA_IBM_QUANTUM_INSTANCE_CRN||'').split(':');
  const validInstance=parts.length===10&&parts.slice(0,5).join(':')==='crn:v1:bluemix:public:quantum-computing'
    &&Object.hasOwn(IBM_QUANTUM_ORIGINS,parts[5])&&/^a\/[a-f0-9]{32}$/i.test(parts[6])
    &&/^[A-Za-z0-9-]{1,128}$/.test(parts[7])&&parts[8]===''&&parts[9]==='';
  const key=env.NUMINA_IBM_QUANTUM_API_KEY;
  const keyValid=typeof key==='string'&&key.length>0&&key.length<=4096&&!/[\s\x00-\x1f\x7f]/.test(key);
  const backend=env.NUMINA_IBM_QUANTUM_BACKEND;
  const backendValid=backend===undefined||backend===''||(typeof backend==='string'&&IBM_QUANTUM_BACKEND_NAME.test(backend));
  return {schema:'numina.ibm-quantum-connection.v1',provider:'ibm_quantum',apiVersion:IBM_QUANTUM_API_VERSION,
    configured:!missing.length&&validInstance&&keyValid&&backendValid,missing,
    configurationError:missing.length?null:!validInstance?'INVALID_INSTANCE_CRN':!keyValid?'INVALID_API_KEY_FORMAT':!backendValid?'INVALID_BACKEND_NAME':null,
    region:validInstance?parts[5]:null,connected:false,providerApiAuthenticated:false,
    hardwareExecutionVerified:false,jobSubmissionEnabled:false,treasuryWrites:false,
    endpoint:'/api/ops/v1/quantum/ibm/connection'};
}
export async function connectIBMQuantum(env={},fetcher=fetch) {
  const configuration=ibmQuantumConfiguration(env),started=performance.now();
  const result={...configuration,status:configuration.configured?'connecting':'configuration_required',observedAt:new Date().toISOString(),backends:[]};
  if(!configuration.configured)return result;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),18000);
  let stage='iam_authentication';
  async function json(url,options) {
    const response=await fetcher(url,{...options,redirect:'error',cache:'no-store',signal:controller.signal});
    if(!response.ok) {
      await response.body?.cancel();
      throw Object.assign(Error('IBM_PROVIDER_RESPONSE'),{httpStatus:response.status});
    }
    const reader=response.body?.getReader();
    if(!reader)throw Error('IBM_RESPONSE_BODY_MISSING');
    const chunks=[];let length=0;
    try {
      for(;;) {
        const {value,done}=await reader.read();if(done)break;
        length+=value.byteLength;
        if(length>1024*1024){await reader.cancel();throw Error('IBM_RESPONSE_TOO_LARGE');}
        chunks.push(value);
      }
    } finally {reader.releaseLock();}
    const bytes=new Uint8Array(length);let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  try {
    const token=await json('https://iam.cloud.ibm.com/identity/token',{method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},
      body:new URLSearchParams({grant_type:'urn:ibm:params:oauth:grant-type:apikey',apikey:env.NUMINA_IBM_QUANTUM_API_KEY})});
    if(typeof token.access_token!=='string'||!token.access_token.length||token.access_token.length>16384||/[\s\x00-\x1f\x7f]/.test(token.access_token))throw Error('IBM_INVALID_TOKEN_RESPONSE');
    stage='backend_discovery';
    const catalog=await json(IBM_QUANTUM_ORIGINS[configuration.region]+'/api/v1/backends',{method:'GET',headers:{
      Authorization:'Bearer '+token.access_token,'Service-CRN':env.NUMINA_IBM_QUANTUM_INSTANCE_CRN,
      'IBM-API-Version':IBM_QUANTUM_API_VERSION,Accept:'application/json'}});
    if(!Array.isArray(catalog.devices)||catalog.devices.length>200)throw Error('IBM_INVALID_BACKEND_RESPONSE');
    // This pinned IBM API defines catalog devices as real hardware; the deprecated simulator flag is still rejected if true.
    if(catalog.devices.some(device=>!device||!IBM_QUANTUM_BACKEND_NAME.test(device.name)||!['online','paused','offline'].includes(device.status?.name)))throw Error('IBM_INVALID_BACKEND_RESPONSE');
    const integer=value=>Number.isSafeInteger(value)&&value>=0?value:null;
    result.backends=catalog.devices.filter(device=>device.is_simulator!==true).map(device=>({name:device.name,
      status:device.status.name,qubits:integer(device.qubits),queueLength:integer(device.queue_length)}));
    result.providerApiAuthenticated=true;
    const selected=env.NUMINA_IBM_QUANTUM_BACKEND
      ?result.backends.find(device=>device.name===env.NUMINA_IBM_QUANTUM_BACKEND)
      :[...result.backends].filter(device=>device.status==='online').sort((a,b)=>(a.queueLength??Infinity)-(b.queueLength??Infinity)||a.name.localeCompare(b.name))[0];
    result.selectedBackend=selected||null;
    result.selectionPolicy=env.NUMINA_IBM_QUANTUM_BACKEND?'configured_backend':'online_backend_with_lowest_reported_queue';
    result.connected=selected?.status==='online';
    result.status=result.connected?'hardware_access_observed':selected?'hardware_unavailable':env.NUMINA_IBM_QUANTUM_BACKEND?'backend_not_available':'no_online_hardware';
    result.evidenceSource='authenticated_ibm_backend_catalog';
    result.observedAt=new Date().toISOString();
  } catch(error) {
    result.status=controller.signal.aborted?'provider_timeout':error.httpStatus===401?'authentication_failed':error.httpStatus===403?'access_denied':error.httpStatus===429?'provider_rate_limited':'provider_unavailable';
    result.failedStage=stage;
    result.providerHttpStatus=Number.isInteger(error.httpStatus)?error.httpStatus:null;
    result.connected=false;
  } finally {clearTimeout(timer);}
  result.durationMs=Math.round(performance.now()-started);
  return result;
}
