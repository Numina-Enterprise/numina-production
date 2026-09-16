import {SIGNING_PINS,isValidatedSigningReview} from './wallet-signing-model.js';
import {WALLET_EXECUTION_POLICY,walletExecutionAuthorized} from './wallet-execution-policy.js';
import {verifyOwnerDeploymentReceipt,RECEIPT_CALLS} from './wallet-execution-receipt.js';
import {requestJson} from './http-client.js';

const executionRoute='/api/control/v1/nusd-deployment';
const freezeExecution=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freezeExecution);Object.freeze(value);}return value;};
const executionCanonical=value=>Array.isArray(value)?'['+value.map(executionCanonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+executionCanonical(value[key])).join(',')+'}':JSON.stringify(value);
const executionHash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(executionCanonical(value)))),b=>b.toString(16).padStart(2,'0')).join('');
const executionError=(code,message)=>Object.assign(new Error(message),{code});
const hex=value=>'0x'+BigInt(value).toString(16);
const rpcInteger=value=>{if(typeof value!=='string'||!/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/.test(value))throw executionError('INVALID_RPC_QUANTITY','The wallet returned an invalid network quantity.');return BigInt(value);};
const unsignedInteger=value=>{if(typeof value!=='string'||!/^(0|[1-9][0-9]{0,77})$/.test(value)||BigInt(value)>=(1n<<256n))throw executionError('INVALID_FEE_LIMIT','Use an exact nonnegative integer fee limit.');return BigInt(value);};
const validTransactionHash=value=>typeof value==='string'&&/^0x[0-9a-fA-F]{64}$/.test(value);
const commitmentFields=c=>({chainId:c.chainId,genesisHash:c.genesisHash,from:c.from,nonce:c.nonce,gasLimit:c.gasLimit,gasPrice:c.gasPrice,maximumFeeBaseUnits:c.maximumFeeBaseUnits,creationSha256:SIGNING_PINS.creation});
const writeIntent=body=>requestJson(executionRoute,{method:'POST',headers:{'Content-Type':'application/json'},body:executionCanonical(body)});

export function createOwnerDeployment({provider,review,onChange=()=>{},now=()=>Date.now(),timeoutMs=30000,
 readIntent=()=>requestJson(executionRoute),claimIntent=writeIntent,reportHash=writeIntent,policy=WALLET_EXECUTION_POLICY,makeId=()=>crypto.randomUUID()}={}){
 if(!isValidatedSigningReview(review))throw executionError('UNTRUSTED_REVIEW','Load the exact published constructor review.');
 if(!provider||typeof provider.request!=='function'||typeof provider.on!=='function'||typeof provider.removeListener!=='function')throw executionError('WALLET_UNAVAILABLE','Open Numina in your wallet-enabled browser.');
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000)throw executionError('INVALID_CONFIGURATION','Invalid wallet deadline.');
 let state='IDLE',candidate=null,transactionHash=null,hashSaved=false,verification=null,attempted=false,busy=false,disposed=false,generation=0,lastError=null;
 const owned=new WeakSet();
 const snapshot=()=>freezeExecution({status:state,candidate,transactionHash,hashSaved,verification,attempted,busy,error:lastError,submissionAllowed:walletExecutionAuthorized(policy),fundsVerified:false,deposited:false,nativeJournalWritten:false});
 const notify=()=>{if(!disposed)try{onChange(snapshot());}catch{}};
 const guard=token=>{if(disposed||token!==generation)throw executionError('WALLET_CHANGED','Wallet account or network changed. Reconcile any existing attempt before continuing.');};
 const clock=()=>{const n=now();if(!Number.isSafeInteger(n)||n<0)throw executionError('INVALID_CLOCK','The observation clock is unavailable.');return n;};
 async function deadline(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(executionError('WALLET_TIMEOUT','The wallet request timed out. Its outcome may be unknown.')),timeoutMs);})]);}finally{clearTimeout(timer);}}
 async function readRpc(method,params,token){
  guard(token);const value=await deadline(provider.request({method,params}));guard(token);return value;
 }
 async function identity(token){
  const chain=rpcInteger(await readRpc('eth_chainId',[],token)).toString();
  const accounts=await readRpc('eth_accounts',[],token);
  if(chain!==SIGNING_PINS.chainId||!Array.isArray(accounts)||typeof accounts[0]!=='string'||accounts[0].toLowerCase()!==SIGNING_PINS.sender.toLowerCase())throw executionError('WALLET_IDENTITY_MISMATCH','Select the treasury account on the configured Numina network.');
  const genesis=await readRpc('eth_getBlockByNumber',['0x0',false],token);
  if(rpcInteger(genesis?.number)!==0n||genesis?.hash?.toLowerCase()!==SIGNING_PINS.genesisHash)throw executionError('GENESIS_MISMATCH','The wallet network genesis does not match Numina.');
 }
 async function run(action){
  if(disposed||busy)throw executionError('WALLET_BUSY','Wait for the current wallet operation.');
  busy=true;lastError=null;const token=generation;notify();
  try{return await action(token);}catch(error){lastError=error?.code??'WALLET_REQUEST_FAILED';throw error;}finally{busy=false;notify();}
 }
 function changed(){generation++;if(!attempted){candidate=null;state='IDLE';}else if(!transactionHash)state='OUTCOME_UNKNOWN';notify();}
 const handlers={accountsChanged:changed,chainChanged:changed,disconnect:changed};
 for(const [name,handler]of Object.entries(handlers))provider.on(name,handler);
 async function saveObservedHash(draft,hash){
  hashSaved=false;
  try{
   const result=await deadline(reportHash({action:'report_hash',attemptId:draft.attemptId,transactionHash:hash})),record=result?.record;
   if(record?.schema!=='numina.nusd.deployment-intent.v1'||record.attemptId!==draft.attemptId||executionCanonical(record.transaction)!==executionCanonical(commitmentFields(draft))||!validTransactionHash(record.reportedTransactionHash)||record.reportedTransactionHash.toLowerCase()!==hash||candidate?.attemptId!==draft.attemptId||transactionHash!==hash)throw executionError('HASH_NOT_SAVED','The reported hash was not confirmed for this exact retained intent.');
   hashSaved=true;if(lastError==='HASH_NOT_SAVED')lastError=null;
  }catch(error){hashSaved=false;lastError='HASH_NOT_SAVED';throw Object.assign(executionError('HASH_NOT_SAVED','The transaction hash remains local until the service confirms this exact retained intent.'),error?.status===undefined?{}:{status:error.status});}
 }
 async function restore(record){
  if(!record)return false;
  const t=record.transaction;
  if(record.schema!=='numina.nusd.deployment-intent.v1'||!t||t.from!==SIGNING_PINS.sender||t.chainId!==SIGNING_PINS.chainId||t.genesisHash!==SIGNING_PINS.genesisHash||t.creationSha256!==SIGNING_PINS.creation||typeof record.attemptId!=='string')throw executionError('INVALID_SAVED_INTENT','The saved deployment intent does not match this request.');
  for(const key of ['nonce','gasLimit','gasPrice','maximumFeeBaseUnits'])unsignedInteger(t[key]);
  if(BigInt(t.gasLimit)===0n||BigInt(t.gasLimit)*BigInt(t.gasPrice)>BigInt(t.maximumFeeBaseUnits))throw executionError('INVALID_SAVED_INTENT','The saved fee fields are inconsistent.');
  const savedHash=validTransactionHash(record.reportedTransactionHash)?record.reportedTransactionHash.toLowerCase():null;
  if(transactionHash&&(record.attemptId!==candidate?.attemptId||executionCanonical(t)!==executionCanonical(commitmentFields(candidate))||(savedHash&&savedHash!==transactionHash)))throw executionError('INVALID_SAVED_INTENT','The saved intent conflicts with the transaction hash retained in this tab.');
  candidate=freezeExecution({...t,attemptId:record.attemptId,value:'0',to:null,data:review.constructorData,preparedAt:null,expiresAt:null});
  attempted=true;transactionHash=savedHash??transactionHash;hashSaved=savedHash!==null;state=transactionHash?'SUBMITTED':'OUTCOME_UNKNOWN';if(transactionHash&&!hashSaved)lastError='HASH_NOT_SAVED';return true;
 }
 return Object.freeze({
  snapshot,
  connect:()=>run(async token=>{
   // Account approval can emit accountsChanged; the complete identity is read afterward.
   await deadline(provider.request({method:'eth_requestAccounts',params:[]}));
   if(disposed)throw executionError('WALLET_CHANGED','Wallet control closed.');
   const current=generation;await identity(current);const status=await readIntent();guard(current);
   await restore(status.record);if(!attempted)state='CONNECTED';return snapshot();
  }),
  prepare:({maximumFeeBaseUnits}={})=>run(async token=>{
   if(attempted)throw executionError('ATTEMPT_ALREADY_EXISTS','Reconcile the existing deployment attempt.');
   const saved=await readIntent();guard(token);if(await restore(saved.record))throw executionError('ATTEMPT_ALREADY_EXISTS','A deployment attempt already exists. Read its receipt; do not submit another.');
   await identity(token);
   const nonce=rpcInteger(await readRpc('eth_getTransactionCount',[SIGNING_PINS.sender,'pending'],token));
   if(nonce>=(1n<<64n)-1n)throw executionError('NONCE_OUT_OF_RANGE','The network nonce is out of range.');
   const gas=rpcInteger(await readRpc('eth_estimateGas',[{from:SIGNING_PINS.sender,value:'0x0',data:review.constructorData},'pending'],token));
   const price=rpcInteger(await readRpc('eth_gasPrice',[],token)),balance=rpcInteger(await readRpc('eth_getBalance',[SIGNING_PINS.sender,'pending'],token));
   const cost=gas*price,maximum=maximumFeeBaseUnits===undefined||maximumFeeBaseUnits===''?cost:unsignedInteger(maximumFeeBaseUnits);
   if(gas===0n||cost>=(1n<<256n)||cost>maximum||maximum>balance)throw executionError('FEE_BUDGET_EXCEEDED','The exact network estimate must fit both your fee limit and the wallet balance.');
   await identity(token);const preparedAt=clock(),attemptId=makeId();
   if(typeof attemptId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(attemptId))throw executionError('INVALID_ATTEMPT_ID','Invalid deployment attempt identifier.');
   const value={chainId:SIGNING_PINS.chainId,genesisHash:SIGNING_PINS.genesisHash,from:SIGNING_PINS.sender,nonce:nonce.toString(),gasLimit:gas.toString(),gasPrice:price.toString(),maximumFeeBaseUnits:maximum.toString(),creationSha256:SIGNING_PINS.creation,value:'0',to:null,data:review.constructorData,preparedAt,expiresAt:preparedAt+60000,attemptId};
   value.draftSha256=await executionHash(value);guard(token);candidate=freezeExecution(value);owned.add(candidate);state='REVIEW_READY';return candidate;
  }),
  submit:draft=>run(async token=>{
   if(!walletExecutionAuthorized(policy))throw executionError('DEPLOYMENT_REVIEWS_REQUIRED','The published issuer policy and production reviews are not approved for signing.');
   if(attempted||draft!==candidate||!owned.has(draft))throw executionError('INVALID_OR_ATTEMPTED_DRAFT','Prepare a fresh exact request, or reconcile the existing attempt.');
   if(clock()<draft.preparedAt||clock()>=draft.expiresAt)throw executionError('QUOTE_EXPIRED','The transaction review expired. Prepare it again.');
   const saved=await readIntent();guard(token);
   if(!saved.submissionAllowed||executionCanonical(saved.policy)!==executionCanonical(policy))throw executionError('DEPLOYMENT_REVIEWS_REQUIRED','The server has not enabled this exact signing release.');
   if(await restore(saved.record))throw executionError('ATTEMPT_ALREADY_EXISTS','A deployment attempt already exists.');
   await identity(token);
   if(rpcInteger(await readRpc('eth_getTransactionCount',[draft.from,'pending'],token)).toString()!==draft.nonce)throw executionError('NONCE_CHANGED','The wallet nonce changed. Prepare and review a new request.');
   const gas=rpcInteger(await readRpc('eth_estimateGas',[{from:draft.from,value:'0x0',data:draft.data},'pending'],token));
   const price=rpcInteger(await readRpc('eth_gasPrice',[],token)),balance=rpcInteger(await readRpc('eth_getBalance',[draft.from,'pending'],token));
   if(gas===0n||gas>BigInt(draft.gasLimit)||price>BigInt(draft.gasPrice)||BigInt(draft.maximumFeeBaseUnits)>balance)throw executionError('ESTIMATE_CHANGED','The estimate or balance changed. Prepare and review again.');
   await identity(token);if(clock()>=draft.expiresAt)throw executionError('QUOTE_EXPIRED','The transaction review expired.');
   attempted=true;state='CLAIM_UNCERTAIN';notify();
   const claimed=await claimIntent({action:'claim',attemptId:draft.attemptId,transaction:commitmentFields(draft)});guard(token);
   if(claimed.fresh!==true||claimed.record?.attemptId!==draft.attemptId||executionCanonical(claimed.record?.transaction)!==executionCanonical(commitmentFields(draft))||claimed.transactionCommitment!==await executionHash(commitmentFields(draft)))throw executionError('INTENT_NOT_NEW','The attempt is already retained. Reconcile it before any further action.');
   await identity(token);
   if(rpcInteger(await readRpc('eth_getTransactionCount',[draft.from,'pending'],token)).toString()!==draft.nonce||clock()>=draft.expiresAt)throw executionError('PRE_SUBMISSION_CHANGED','Network state changed after the intent was retained. No wallet request was made; reconcile the retained intent.');
   state='AWAITING_WALLET';notify();guard(token);
   const tx={type:'0x0',chainId:hex(draft.chainId),from:draft.from,nonce:hex(draft.nonce),gas:hex(draft.gasLimit),gasPrice:hex(draft.gasPrice),value:'0x0',data:draft.data};
   // Exactly one write request. Its late response is retained even after timeout/change.
   let dispatch;try{dispatch=Promise.resolve(provider.request({method:'eth_sendTransaction',params:[tx]}));}catch(error){dispatch=Promise.reject(error);}
   const observed=dispatch.then(hash=>{if(!validTransactionHash(hash))throw executionError('INVALID_TRANSACTION_HASH','The wallet returned no usable transaction hash. Reconcile its activity before continuing.');transactionHash=hash.toLowerCase();hashSaved=false;lastError='HASH_NOT_SAVED';state='SUBMITTED';notify();return transactionHash;});
   try{
    await deadline(observed);
    if(!disposed)try{await saveObservedHash(draft,transactionHash);}catch{lastError='HASH_NOT_SAVED';}
    return snapshot();
   }catch(error){if(!transactionHash)state=error?.code===4001?'WALLET_DECLINED':'OUTCOME_UNKNOWN';throw error;}
  }),
  adoptHash:hash=>run(async token=>{
   if(!candidate||!attempted||!validTransactionHash(hash))throw executionError('SAVED_INTENT_REQUIRED','A retained intent and public transaction hash are required.');
   await identity(token);const tx=await readRpc('eth_getTransactionByHash',[hash],token);
   if(!tx||tx.hash?.toLowerCase()!==hash.toLowerCase()||tx.from?.toLowerCase()!==candidate.from.toLowerCase()||tx.to!==null||rpcInteger(tx.type)!==0n||rpcInteger(tx.nonce).toString()!==candidate.nonce||rpcInteger(tx.chainId).toString()!==candidate.chainId||tx.input?.toLowerCase()!==candidate.data.toLowerCase()||rpcInteger(tx.value)!==0n||rpcInteger(tx.gas).toString()!==candidate.gasLimit||rpcInteger(tx.gasPrice).toString()!==candidate.gasPrice)throw executionError('TRANSACTION_MISMATCH','The transaction does not match the retained request.');
   if(transactionHash&&transactionHash!==hash.toLowerCase())throw executionError('TRANSACTION_HASH_CONFLICT','Another hash is already retained for this intent.');
   transactionHash=hash.toLowerCase();hashSaved=false;lastError='HASH_NOT_SAVED';state='SUBMITTED';
   await saveObservedHash(candidate,transactionHash);return snapshot();
  }),
  checkReceipt:()=>run(async token=>{
   if(!candidate||!transactionHash)throw executionError('TRANSACTION_HASH_REQUIRED','A matching submitted transaction hash is required.');
   await identity(token);
   const transaction=await readRpc('eth_getTransactionByHash',[transactionHash],token),receipt=await readRpc('eth_getTransactionReceipt',[transactionHash],token);
   if(!receipt){state='PENDING';verification=null;return snapshot();}
   if(receipt.status==='0x0'){state='REVERTED';verification=null;return snapshot();}
   if(!validTransactionHash(receipt.blockHash)||!/^0x[0-9a-fA-F]{40}$/.test(receipt.contractAddress??''))throw executionError('INVALID_RECEIPT','The receipt is incomplete.');
   const blockTag={blockHash:receipt.blockHash,requireCanonical:true};
   const canonicalBlock=await readRpc('eth_getBlockByNumber',[receipt.blockNumber,false],token),headBlock=await readRpc('eth_getBlockByNumber',['latest',false],token);
   const runtimeCode={address:receipt.contractAddress,blockHash:receipt.blockHash,code:await readRpc('eth_getCode',[receipt.contractAddress,blockTag],token)};
   const calls=[];
   for(const call of RECEIPT_CALLS){calls.push({to:receipt.contractAddress,data:call.data,blockHash:receipt.blockHash,result:await readRpc('eth_call',[{to:receipt.contractAddress,data:call.data},blockTag],token)});}
   const finalBlockReread=await readRpc('eth_getBlockByNumber',[receipt.blockNumber,false],token);await identity(token);
   const reviewedReceipt=await verifyOwnerDeploymentReceipt({candidate:{...candidate,submittedHash:transactionHash},transaction,receipt,canonicalBlock,headBlock,finalBlockReread,runtimeCode,calls});guard(token);verification=reviewedReceipt;
   if(verification.valid&&(!Number.isSafeInteger(policy?.minimumConfirmations)||policy.minimumConfirmations<12||BigInt(verification.candidateDeployment.confirmations)<BigInt(policy.minimumConfirmations)))verification=freezeExecution({...verification,valid:false,status:'EVIDENCE_INCOMPLETE_OR_INCONSISTENT',errors:[...verification.errors,'APPROVED_CONFIRMATION_POLICY'],candidateDeployment:null});
   state=verification.valid?'RECEIPT_VERIFIED':'RECEIPT_UNVERIFIED';return snapshot();
  }),
  dispose:()=>{if(disposed)return;disposed=true;generation++;for(const [name,handler]of Object.entries(handlers))provider.removeListener(name,handler);}
 });
}
