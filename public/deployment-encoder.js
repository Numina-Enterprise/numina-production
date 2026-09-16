import {Interface,getAddress,ZeroAddress,getBytes} from './vendor/ethers-6.15.0.min.js';
import {assessInputs,createLocalDraft,createConstructorRequest} from './deployment-readiness-model.js';
export const PINS=Object.freeze({artifact:'a77132febebe10172a7fe3ee1814ed124ea5503b93f1e2e4ffdfb218889a262a',source:'87755643e690b82b11a9f5744f1dd9803965b0f38fa9ac4d18542e72b4bb80cc',policy:'95f806c9c64fd2cee955eb0c05ffcb6653f4cdeab33a85b993e1bd4c60f3092c'});
export const ARGUMENTS=Object.freeze(['initialSupplyBaseUnits','initialRecipient','admin','issuer','minter','pauser','adminDelaySeconds','approvedIssuerPolicyHash']);
export const REVIEW_IDS=Object.freeze(['independentSecurityAudit','authorizedIssuerAndJurisdictions','custodianAndReserveEvidence','redeemabilityTermsAndOperations','financialCrimeAndSanctionsControls','independentRoleKeyCustody','incidentAndPauseRecovery','applicationSettlementAndFulfillmentReview']);
export const sha256=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof bytes==='string'?new TextEncoder().encode(bytes):bytes)),value=>value.toString(16).padStart(2,'0')).join('');
export function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';return JSON.stringify(value);}
export function publicAddress(value){if(typeof value!=='string'||!/^0x[0-9a-fA-F]{40}$/.test(value))throw Error('Expected a public 20-byte address');const address=getAddress(value);if(address===ZeroAddress)throw Error('Zero address is not allowed');return address;}
export function exactInteger(value,bits=256){if(typeof value!=='string'||!/^(0|[1-9][0-9]*)$/.test(value)||BigInt(value)>=(1n<<BigInt(bits)))throw Error('Expected an exact unsigned integer string');return BigInt(value);}

export async function prepareReview(input){
 const {request,artifactBytes,sourceBytes,policyBytes}=structuredClone(input);
 const issues=[],add=(field,message)=>issues.push({field,message});
 for(const [kind,bytes] of Object.entries({artifact:artifactBytes,source:sourceBytes,policy:policyBytes}))if(await sha256(bytes)!==PINS[kind])add(kind,'Bytes do not match the published approved review');
 let artifact,policy;try{artifact=JSON.parse(new TextDecoder().decode(artifactBytes));policy=JSON.parse(new TextDecoder().decode(policyBytes));}catch{add('artifacts','Invalid JSON');}
 const entries=request?.constructor;
 if(request?.schema!=='numina.nusd.uncapped-deployment-review.v1'||request?.candidateSchema!=='numina.nusd.contract-candidate.v3'||request?.supplyPolicy!=='uncapped')add('request','Expected the uncapped v3 review request');
 if(!Array.isArray(entries)||entries.length!==8||entries.some((entry,i)=>!entry||typeof entry!=='object'||entry.name!==ARGUMENTS[i]||Object.keys(entry).sort().join(',')!=='name,type,value'))add('constructor','Exactly eight ordered constructor arguments are required');
 const constructor=Object.fromEntries((Array.isArray(entries)?entries:[]).filter(entry=>entry&&typeof entry==='object').map(entry=>[entry.name,entry.value]));
 const types=['uint256','address','address','address','address','address','uint48','bytes32'];
 const abi=artifact?.abi?.find(entry=>entry.type==='constructor');
 if(artifact?.schema!=='numina.nusd.contract-candidate.v3'||artifact?.sourceSha256!==PINS.source||abi?.inputs?.length!==8||abi.inputs.some((entry,i)=>entry.name!==ARGUMENTS[i]||entry.type!==types[i])||artifact.abi.some(entry=>entry.name==='cap'))add('artifact','Wrong contract version or constructor ABI');
 if(Array.isArray(entries)&&entries.some((entry,i)=>entry?.type!==types[i]))add('constructor','Argument types do not match the reviewed ABI');
 if(constructor.initialSupplyBaseUnits!=='500000000000000000000'||policy?.token?.initialSupplyBaseUnits!==constructor.initialSupplyBaseUnits)add('initialSupplyBaseUnits','This policy requires exactly 500T NUSD; changing to zero requires a revised request and policy');
 for(const name of ['initialRecipient','admin','issuer','minter','pauser']){try{constructor[name]=publicAddress(constructor[name]);}catch{add(name,'Explicit valid nonzero public address required');}}
 const roles=['admin','issuer','minter','pauser'];
 if(new Set(roles.map(name=>constructor[name]?.toLowerCase())).size!==4)add('roles','The four privileged roles must be distinct');
 for(const name of roles)if(constructor[name]?.toLowerCase()!==policy?.roles?.[name]?.toLowerCase())add(name,'Role differs from the approved policy');
 try{exactInteger(constructor.adminDelaySeconds,48);if(constructor.adminDelaySeconds!==policy?.adminDelaySeconds)throw Error();}catch{add('adminDelaySeconds','Delay differs from the approved policy');}
 if(constructor.approvedIssuerPolicyHash!=='0x'+PINS.policy||request?.preparationPolicy?.sha256!==PINS.policy)add('approvedIssuerPolicyHash','Policy bytes and request hash must match');
 if(request?.artifact?.sha256!==PINS.artifact||request?.source?.sha256!==PINS.source)add('requestHashes','Request must pin the approved source and artifact');
 let constructorData=null;if(!issues.length){const iface=new Interface(artifact.abi);constructorData=artifact.bytecode+iface.encodeDeploy(ARGUMENTS.map(name=>constructor[name])).slice(2);}
 const unresolvedReviews=REVIEW_IDS.map(id=>({id,referencePresent:request?.unresolvedReviewRecords?.[id]!=null,verification:'not_verified_by_this_tool'}));
 // Never echo arbitrary input into a review file: an invalid field can contain a pasted secret.
 const safeConstructor=Object.fromEntries(ARGUMENTS.map(name=>{let value=null;if(['initialRecipient',...roles].includes(name)){try{value=publicAddress(constructor[name]);}catch{}}else if(name==='initialSupplyBaseUnits'&&constructor[name]==='500000000000000000000')value=constructor[name];else if(name==='adminDelaySeconds'&&constructor[name]==='86400')value=constructor[name];else if(name==='approvedIssuerPolicyHash'&&constructor[name]==='0x'+PINS.policy)value=constructor[name];return [name,value];}));
 return {schema:'numina.nusd.unsigned-constructor-review.v1',status:issues.length?'BLOCKED':'UNSIGNED_CONSTRUCTOR_REVIEW',scope:'offline_encoding_only_not_production_readiness',requestSha256:await sha256(canonical(request)),artifactSha256:PINS.artifact,sourceSha256:PINS.source,issuerPolicySha256:PINS.policy,constructor:safeConstructor,constructorData,constructorDataSha256:constructorData?await sha256(getBytes(constructorData)):null,issues,unresolvedReviews,remainingBeforeSigning:['reviewed_chain_and_genesis','explicit_sender_and_signing_control','current_nonce_and_fee_estimate','fee_budget_and_fee_balance','recipient_control_and_asset_acceptance','actual_review_findings_and_evidence','owner_wallet_review'],walletTransaction:null,productionReady:false,reviewEvidenceVerified:false,signed:false,broadcast:false,receipt:null};
}

export const ASSET_PATHS=Object.freeze({artifactBytes:'/downloads/approved-reviews/nusd-uncapped-500t/artifacts/NuminaUSD.json',sourceBytes:'/downloads/approved-reviews/nusd-uncapped-500t/contracts/NuminaUSD.sol',policyBytes:'/downloads/approved-reviews/nusd-uncapped-500t/requests/issuance-preparation-policy.json'});
export async function loadPreparationAssets(signal,timeoutMs=15000){
 const controller=new AbortController();let timer,onAbort;
 try{return await Promise.race([
  new Promise((_,reject)=>{onAbort=()=>{controller.abort();reject(Error('Preparation loading cancelled.'));};if(signal?.aborted){onAbort();return;}signal?.addEventListener('abort',onAbort,{once:true});timer=setTimeout(()=>{controller.abort();reject(Error('Preparation loading timed out.'));},timeoutMs);}),
  (async()=>Object.fromEntries(await Promise.all(Object.entries(ASSET_PATHS).map(async([key,path])=>{
   if(controller.signal.aborted)throw Error('Preparation loading cancelled.');
   const response=await fetch(path,{method:'GET',credentials:'omit',redirect:'error',cache:'no-store',signal:controller.signal});
   if(!response.ok||!response.body)throw Error('Published contract inputs could not be loaded.');
   const limit=2000000;
   if(Number(response.headers.get('Content-Length'))>limit)throw Error('Published contract input exceeds the expected size.');
   const reader=response.body.getReader(),chunks=[];let length=0;
   try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>limit)throw Error('Published contract input exceeds the expected size.');chunks.push(value);}}
   catch(error){await reader.cancel().catch(()=>{});throw error;}
   finally{reader.releaseLock();}
   const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
   return [key,bytes];
  }))))()
 ]);}finally{controller.abort();clearTimeout(timer);signal?.removeEventListener('abort',onAbort);}
}
export async function prepareDeployment(seed,input,assets){
 const snapshot=structuredClone(input),state=assessInputs(snapshot);
 if(state.invalid.length)throw Error('Correct the marked working inputs before preparing.');
 const request=createConstructorRequest(seed,snapshot);
 if(state.values.chainId&&state.values.chainId!==String(request.network.chainId))throw Error('Chain ID must match the reviewed Numina network.');
 const review=await prepareReview({request,...assets});
 if(review.status==='BLOCKED')return {review,request,transactionDraft:null};
 const values=state.values;
 // A recipient is never used as the sender implicitly.
 if(values.sender)publicAddress(values.sender);
 const missing=Object.keys(values).filter(key=>values[key]===null);
 let transactionDraft=null;
 if(!missing.length){
  const fee=BigInt(values.gasLimit)*BigInt(values.gasPrice);
  if(fee>BigInt(values.maximumFee))throw Error('Gas limit × gas price exceeds the maximum total fee.');
  const transaction={type:0,chainId:values.chainId,from:publicAddress(values.sender),to:null,value:'0',gasLimit:values.gasLimit,gasPrice:values.gasPrice,data:review.constructorData};
  transactionDraft={schema:'numina.nusd.unsigned-deployment-draft.v2',status:'UNSIGNED_UNVERIFIED_DRAFT',noncePolicy:'wallet_assigned_before_signing',transactionComplete:false,requestSha256:review.requestSha256,artifactSha256:PINS.artifact,issuerPolicySha256:PINS.policy,constructorDataSha256:review.constructorDataSha256,transaction,network:{chainId:values.chainId,genesisHash:values.genesisHash,identityVerified:false},fee:{model:'legacy',assetLabel:values.feeAsset,maximumTotalBaseUnits:values.maximumFee,calculatedTotalBaseUnits:fee.toString(),estimateVerified:false,balanceVerified:false},inputsVerified:false,productionReady:false,reviewEvidenceVerified:false,signed:false,broadcast:false,receipt:null};
  transactionDraft.draftSha256=await sha256(canonical(transactionDraft));
 }
 return {schema:'numina.nusd.browser-preparation.v1',request,review,localDraft:createLocalDraft(snapshot),transactionDraft,missingTransactionInputs:missing,productionReady:false,reviewEvidenceVerified:false,signed:false,broadcast:false,receipt:null};
}
