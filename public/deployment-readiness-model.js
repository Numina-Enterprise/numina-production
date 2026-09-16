export const READINESS_PACKAGE_SHA='9304f2f3e0a72c2a8db857ad0ee3557523eccfac0b61db3d39e33626b40baeea';
export const READINESS_INPUTS_SHA='a4382e46f930ff2b80ecc5b27b2966c24c40a2e37c26c50558ee90cd71d75900';
const trustedSeeds=new WeakSet();
const sorted=value=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sorted(value[key])])):value;
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
export const DRAFT_FIELDS=['recipient','sender','chainId','genesisHash','nonce','maximumFee'];
const address=value=>/^0x[0-9a-fA-F]{40}$/.test(value)&&!/^0x0{40}$/.test(value);
const integer=value=>/^(0|[1-9][0-9]{0,77})$/.test(value)&&BigInt(value)<2n**256n;
export function assessInputs(input={}){
  const values={},invalid=[];
  for(const field of DRAFT_FIELDS){
    const raw=typeof input[field]==='string'?input[field].trim():'';
    const valid=raw&&(field==='recipient'||field==='sender'?address(raw):field==='genesisHash'?/^0x[0-9a-fA-F]{64}$/.test(raw):integer(raw)&&(field!=='chainId'||BigInt(raw)>0n));
    values[field]=valid?raw:null;
    if(raw&&!valid)invalid.push(field);
  }
  return {values,invalid,entered:Object.values(values).filter(value=>value!==null).length,productionReady:false};
}
export async function validateReadinessSource(seed,descriptor){
  seed=structuredClone(seed);descriptor=structuredClone(descriptor);
  // Pin the entire public input sheet, not the package hash label within it.
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(sorted(seed))));
  const actual=Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
  if(actual!==READINESS_INPUTS_SHA)throw Error('Preparation input bytes differ from the published template.');
  if(seed?.schema!=='numina.deployment-readiness-inputs.v1'||seed.package?.sha256!==READINESS_PACKAGE_SHA||descriptor?.productionPreparation?.sha256!==READINESS_PACKAGE_SHA||seed.package.productionReady!==false||seed.package.financialExecution!==false||descriptor.execution?.submission_performed!==false)throw Error('Preparation sources do not match.');
  if(seed.request?.constructor?.length!==8||seed.request.constructor[0]?.value!=='500000000000000000000'||seed.request.constructor[1]?.name!=='initialRecipient'||seed.request.constructor[1]?.value!==null||seed.request.encoded!==false||seed.request.broadcast!==false||seed.request.supplyPolicy!=='uncapped'||seed.requirements?.items?.length!==36||seed.requirements.items.some(item=>item.status!=='UNRESOLVED'))throw Error('Preparation inputs changed; review the current package.');
  const pinned=freeze(seed);trustedSeeds.add(pinned);return pinned;
}
export function createLocalDraft(input){
  const assessment=assessInputs(input);
  return {schema:'numina.deployment-readiness-draft.v1',packageSha256:READINESS_PACKAGE_SHA,inputs:assessment.values,invalidFields:assessment.invalid,productionReady:false,reviewEvidenceVerified:false,walletTransaction:null,signed:false,broadcast:false,receipt:null};
}
export function importLocalDraft(text){
  if(typeof text!=='string'||text.length>32768)throw Error('Choose a readiness draft smaller than 32 KB.');
  let value;try{value=JSON.parse(text);}catch{throw Error('This file is not valid JSON.');}
  if(value?.schema!=='numina.deployment-readiness-draft.v1'||value.packageSha256!==READINESS_PACKAGE_SHA||!value.inputs||typeof value.inputs!=='object'||Array.isArray(value.inputs))throw Error('Choose a draft for this preparation package.');
  // Ignore imported approvals, transaction data, arbitrary fields and invalid values.
  return createLocalDraft(value.inputs);
}
export function createConstructorRequest(seed,input){
  if(!trustedSeeds.has(seed))throw Error('Confirm the published preparation inputs first.');
  const recipient=assessInputs(input).values.recipient;
  if(!recipient)throw Error('Enter a nonzero public NUSD recipient address.');
  const result=structuredClone(seed.request);
  // Preserve mixed-case checksums for the offline tool's strict address validation.
  result.constructor[1].value=recipient;
  result.encoded=false;result.submissionApproved=false;result.signed=false;result.broadcast=false;
  result.contractAddress=null;result.transactionHash=null;result.receipt=null;
  result.network.identityVerified=false;
  result.preparationPolicy.executionAuthorization=false;
  result.walletTransaction={from:null,to:null,value:'0',data:null,nonce:null,gasLimit:null,maxFeePerGas:null,maxPriorityFeePerGas:null};
  for(const id of Object.keys(result.unresolvedReviewRecords))result.unresolvedReviewRecords[id]=null;
  result.encodingBlockedBy=['Recipient supplied locally; control and NUSD acceptance still require review','Network, signing inputs and independent reviews remain incomplete','Run the matching offline preparation tool; no encoded transaction is created by this website'];
  return result;
}
