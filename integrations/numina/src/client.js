import {verifyTreasuryRecord} from './treasury-proof.js';
import {EXPECTED_RELEASE} from './runtime-contract.js';
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const KEY=/^[A-Za-z0-9][A-Za-z0-9_-]{15,127}$/;
const FORBIDDEN=/^(authorization|api[_-]?key|access[_-]?token|secret|password|private[_-]?key)$/i;

export class NuminaError extends Error {
  constructor(code,status){super(code);this.name='NuminaError';this.code=code;if(status)this.status=status;}
}
function fail(code,status){throw new NuminaError(code,status);}
function object(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function exact(value,keys){if(!object(value)||Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k)))fail('INVALID_ARGUMENTS');}
function text(value,min,max){return typeof value==='string'&&value.length>=min&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);}
export function validateArguments(name,input){
  if(name==='numina_nusd_quote'){
    exact(input,['service_id','units','unit','idempotency_key']);
    if(!ID.test(input.service_id)||typeof input.service_id!=='string'||typeof input.units!=='string'||!/^[1-9][0-9]{0,29}$/.test(input.units)||!text(input.unit,1,64)||typeof input.idempotency_key!=='string'||!KEY.test(input.idempotency_key))fail('INVALID_ARGUMENTS');
  }else if(name==='numina_nusd_request'){
    exact(input,['quote_id','description','idempotency_key']);
    if(typeof input.quote_id!=='string'||!ID.test(input.quote_id)||!text(input.description,1,4000)||typeof input.idempotency_key!=='string'||!KEY.test(input.idempotency_key))fail('INVALID_ARGUMENTS');
  }else if(name==='numina_nusd_status'){
    exact(input,['request_id']);if(input.request_id!==null&&(typeof input.request_id!=='string'||!ID.test(input.request_id)))fail('INVALID_ARGUMENTS');
  }else if(name==='numina_read_treasury'||name==='numina_nusd_network'||name==='numina_service_catalog'||name==='numina_application_release'||name==='numina_runtime_build'){
    exact(input,[]);
  }else fail('UNKNOWN_TOOL');
  return input;
}
function sanitize(value,token,depth=0){
  if(depth>25)fail('INVALID_SERVER_RESPONSE');
  if(typeof value==='string')return token?value.split(token).join('[redacted]'):value;
  if(Array.isArray(value))return value.map(v=>sanitize(v,token,depth+1));
  if(object(value))return Object.fromEntries(Object.entries(value).filter(([k])=>!FORBIDDEN.test(k)).map(([k,v])=>[token?k.split(token).join('[redacted]'):k,sanitize(v,token,depth+1)]));
  return value;
}

export class NuminaClient {
  #origin;#token;#assetId;#fetch;#timeout;#maxBytes;
  constructor({baseUrl,token,expectedAssetId,fetch:fetchImpl=globalThis.fetch,timeoutMs=10000,maxResponseBytes=262144}={}){
    let url;try{url=new URL(baseUrl);}catch{fail('INVALID_ENDPOINT');}
    if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)fail('INVALID_ENDPOINT');
    if(token===null||token==='')token=undefined;
    if(token!==undefined&&(typeof token!=='string'||token.length<16||token.length>4096||/[^\x21-\x7e]/.test(token)))fail('INVALID_SERVER_AUTH');
    if(expectedAssetId!==undefined&&!text(expectedAssetId,1,256))fail('INVALID_ASSET_PIN');
    if(typeof fetchImpl!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000||!Number.isInteger(maxResponseBytes)||maxResponseBytes<256||maxResponseBytes>1048576)fail('INVALID_CONFIGURATION');
    this.#origin=url.origin;this.#token=token;this.#assetId=expectedAssetId;this.#fetch=fetchImpl;this.#timeout=timeoutMs;this.#maxBytes=maxResponseBytes;
  }
  #requireAuth(){if(!this.#token)fail('SERVER_AUTH_REQUIRED');}
  async #send(path,body){
    const privateOperation=!['/status','/catalog','/application-release'].includes(path);if(privateOperation)this.#requireAuth();
    const endpoint=path==='/treasury'?'/api/control/v1/treasury':path==='/application-release'?'/v4/release/manifest':path==='/catalog'?'/api/app/v1/catalog':'/api/nusd/v1'+path;
    const controller=new AbortController();let timer,reader;
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new NuminaError('REQUEST_TIMEOUT'));},this.#timeout);});
    try{
      const headers={Accept:'application/json'};
      if(privateOperation)headers.Authorization='Bearer '+this.#token;
      if(body){headers['Content-Type']='application/json';headers['Idempotency-Key']=body.idempotency_key;}
      const response=await Promise.race([this.#fetch(this.#origin+endpoint,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,signal:controller.signal,redirect:'error',credentials:'omit',cache:'no-store'}),timeout]);
      if(response.redirected||response.status>=300&&response.status<400)fail('REDIRECT_REFUSED');
      if(!response.ok)fail(response.status===401||response.status===403?'SERVER_AUTH_REJECTED':'SERVER_REQUEST_REJECTED',response.status);
      if((response.headers.get('content-type')||'').split(';')[0].trim()!=='application/json')fail('INVALID_SERVER_RESPONSE');
      if(Number(response.headers.get('content-length'))>this.#maxBytes)fail('RESPONSE_TOO_LARGE');
      reader=response.body?.getReader();if(!reader)fail('INVALID_SERVER_RESPONSE');
      const chunks=[];let size=0;
      for(;;){const {done,value}=await Promise.race([reader.read(),timeout]);if(done)break;size+=value.byteLength;if(size>this.#maxBytes)fail('RESPONSE_TOO_LARGE');chunks.push(value);}
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
      let data;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('INVALID_SERVER_RESPONSE');}
      if(!object(data))fail('INVALID_SERVER_RESPONSE');
      // Server output is data, never instructions or independent reserve evidence.
      return sanitize(data,this.#token);
    }catch(error){if(error instanceof NuminaError)throw error;fail(controller.signal.aborted?'REQUEST_TIMEOUT':'CONNECTION_FAILED');}
    finally{clearTimeout(timer);controller.abort();if(reader)void reader.cancel().catch(()=>{});}
  }
  #wrap(data){return {source:'configured_numina_server',verification:'server_reported_not_independently_verified',client_capabilities:['release','runtimeBuild','readTreasury','quote','request','status','network','catalog'],asset_execution_available:false,data};}
  async readTreasury(input={}){
    validateArguments('numina_read_treasury',input);this.#requireAuth();
    await this.release({});
    const data=await this.#send('/treasury');
    if(!await verifyTreasuryRecord(data,{allowUninitialized:true}))fail('INVALID_TREASURY_PROOF');
    return this.#wrap(data);
  }
  async release(input={}){
    validateArguments('numina_application_release',input);
    const data=await this.#send('/application-release');
    if(data.schema!=='numina.application-release.v2'||data.schema_version!==2||data.product!=='Numina'||
      typeof data.version!=='string'||!/^[234]\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(data.version)||
      data.release!=='numina-v'+data.version||data.artifact_digest_algorithm!=='sha256'||
      typeof data.build_id!=='string'||!/^[a-f0-9]{64}$/.test(data.build_id)||
      !Array.isArray(data.artifacts)||data.artifacts.length<1||data.artifacts.length>10000||
      data.artifacts.some(artifact=>!object(artifact)||!text(artifact.path,1,2048)||typeof artifact.sha256!=='string'||!/^[a-f0-9]{64}$/.test(artifact.sha256))||
      !object(data.runtime_dependency)||!text(data.runtime_dependency.version,1,128))fail('INVALID_SERVER_RESPONSE');
    if(data.runtime_dependency.version!==EXPECTED_RELEASE.production_version || data.runtime_dependency.release!==EXPECTED_RELEASE.release)fail('RUNTIME_RELEASE_MISMATCH');
    // Preserve application identity and require the shared rc26 runtime target.
    // Schema recognition is not signature, artifact, deployment or reserve verification.
    return this.#wrap(data);
  }
  async status(input={request_id:null}){
    validateArguments('numina_nusd_status',input);
    const data=await this.#send(input.request_id===null?'/status':'/requests/'+encodeURIComponent(input.request_id));
    if(data.schema!==(input.request_id===null?'numina.nusd.status.v1':'numina.nusd.request.v1'))fail('INVALID_SERVER_RESPONSE');
    if(input.request_id!==null&&data.request_id!==input.request_id)fail('REQUEST_ID_MISMATCH');
    return this.#wrap(data);
  }
  async runtimeBuild(input={}){
    validateArguments('numina_runtime_build',input);
    const {data}=await this.release({});
    const build=data.execution_runtime_build;
    if(build===undefined||build===null)fail('RUNTIME_BUILD_UNAVAILABLE');
    if(!object(build)||!text(build.product,1,256)||!text(build.status,1,256)||
      !Number.isSafeInteger(build.run_id)||build.run_id<1||!text(build.run_url,1,2048)||
      ['source_commit','builder_commit'].some(key=>typeof build[key]!=='string'||!/^[a-f0-9]{40}$/.test(build[key]))||
      ['inventory_sha256','image_archive_sha256','source_archive_sha256'].some(key=>typeof build[key]!=='string'||!/^[a-f0-9]{64}$/.test(build[key]))||
      ['inventory','provenance'].some(key=>!text(build[key],1,2048))||
      ['builder_signed_artifacts_verified','application_started_by_build','production_host_deployment_verified','financial_execution_established'].some(key=>typeof build[key]!=='boolean')||
      !object(data.financial_status_sources)||!object(data.scope))fail('INVALID_SERVER_RESPONSE');
    const rootRecords={};
    for(const field of ['nusd_transaction_receipts','nusd_activation_readiness','denomination_policy','contract_record']){
      // Older v2 manifests may omit these records. Never synthesize evidence or
      // turn an absent readiness record into a positive or negative assertion.
      if(!Object.hasOwn(data,field))continue;
      if(!object(data[field]))fail('INVALID_SERVER_RESPONSE');
      rootRecords[field]=data[field];
    }
    // These are the application's dated build claims and evidence links. No linked
    // document, receipt, artifact, account or financial endpoint is fetched by this
    // tool. Root receipt/readiness contents retain their server-reported meaning.
    return this.#wrap({application_identity:{version:data.version,release:data.release,build_id:data.build_id},
      runtime_dependency:data.runtime_dependency,execution_runtime_build:build,
      financial_status_sources:data.financial_status_sources,scope:data.scope,...rootRecords,
      signature_verification_performed:false,artifact_bytes_checked:false,current_financial_status_checked:false,
      receipt_verification_performed:false,readiness_verification_performed:false});
  }
  async network(input={}){
    validateArguments('numina_nusd_network',input);
    const {data}=await this.status({request_id:null});
    if(data.network_policy!==undefined&&data.network_policy!==null&&!object(data.network_policy))fail('INVALID_SERVER_RESPONSE');
    if(data.denomination_policy!==undefined&&!object(data.denomination_policy))fail('INVALID_SERVER_RESPONSE');
    if(data.contract_record!==undefined&&!object(data.contract_record))fail('INVALID_SERVER_RESPONSE');
    return this.#wrap({...(data.contract_record===undefined?{}:{contract_record:data.contract_record}),...(data.denomination_policy===undefined?{}:{denomination_policy:data.denomination_policy}),network_policy:data.network_policy??null,asset:data.asset??null,
      asset_verification:data.asset_verification??null,capabilities:data.capabilities??null,
      blockchain_rpc_checked:false,independently_verified:false});
  }
  async catalog(input={}){
    validateArguments('numina_service_catalog',input);
    const data=await this.#send('/catalog');
    if(!object(data.offers)||!text(data.operator,1,256)||!text(data.scopeTerms,1,16000)||
      Object.keys(data.offers).length>1000)fail('INVALID_SERVER_RESPONSE');
    for(const [key,offer]of Object.entries(data.offers)){
      if(!ID.test(key)||!object(offer)||!text(offer.name,1,256)||!text(offer.description,1,16000)||
        !['usd','nusd'].includes(offer.currency)||(offer.amount!==null&&(!Number.isSafeInteger(offer.amount)||offer.amount<0))||
        (Object.hasOwn(offer,'requestOnly')&&typeof offer.requestOnly!=='boolean')||
        (offer.amount===null&&offer.requestOnly!==true))fail('INVALID_SERVER_RESPONSE');
    }
    // Preserve currency, raw amount, request-only state and all server qualifications.
    // This read neither follows catalog links nor creates a quote or entitlement.
    return this.#wrap(data);
  }
  async #available(capability){
    this.#requireAuth();if(!this.#assetId)fail('NUSD_ASSET_PIN_REQUIRED');
    const {data}=await this.status();
    if(data.asset?.symbol!=='NUSD'||!text(data.asset.asset_id,1,256)||data.asset_verification?.status!=='verified'||!Array.isArray(data.asset_verification.evidence)||!data.asset_verification.evidence.length)fail('NUSD_NOT_VERIFIED');
    if(data.capabilities?.[capability]!==true)fail('CAPABILITY_UNAVAILABLE');
    if(data.asset.asset_id!==this.#assetId)fail('NUSD_ASSET_MISMATCH');
    return data.asset.asset_id;
  }
  async quote(input){
    input=structuredClone(validateArguments('numina_nusd_quote',input));const assetId=await this.#available('quote');
    const data=await this.#send('/quotes',input);
    if(data.schema!=='numina.nusd.quote.v1'||typeof data.quote_id!=='string'||!ID.test(data.quote_id)||data.asset_id!==assetId||data.symbol!=='NUSD'||typeof data.amount_base_units!=='string'||!/^[1-9][0-9]{0,59}$/.test(data.amount_base_units)||!Number.isInteger(data.decimals)||data.decimals<0||data.decimals>30||!Number.isSafeInteger(data.expires_at)||data.expires_at<=Math.floor(Date.now()/1000))fail('INVALID_SERVER_QUOTE');
    return this.#wrap(data);
  }
  async request(input){
    input=structuredClone(validateArguments('numina_nusd_request',input));const assetId=await this.#available('request');
    const data=await this.#send('/requests',input);
    if(data.schema!=='numina.nusd.request.v1'||typeof data.request_id!=='string'||!ID.test(data.request_id)||data.quote_id!==input.quote_id||data.asset_id!==assetId)fail('INVALID_SERVER_RESPONSE');
    return this.#wrap(data);
  }
  async callTool(name,input){
    if(name==='numina_read_treasury')return this.readTreasury(input);
    validateArguments(name,input);
    if(name==='numina_application_release')return this.release(input);
    if(name==='numina_runtime_build')return this.runtimeBuild(input);
    if(name==='numina_nusd_quote')return this.quote(input);
    if(name==='numina_nusd_request')return this.request(input);
    if(name==='numina_nusd_network')return this.network(input);
    if(name==='numina_service_catalog')return this.catalog(input);
    return this.status(input);
  }
}
