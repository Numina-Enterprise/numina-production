import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {Interface,getCreateAddress,ZeroAddress} from '../public/vendor/ethers-6.15.0.min.js';
import {SIGNING_PINS,validateSigningReview} from '../public/wallet-signing-model.js';
import {WALLET_EXECUTION_POLICY,walletExecutionAuthorized} from '../public/wallet-execution-policy.js';
import {RECEIPT_CALLS} from '../public/wallet-execution-receipt.js';
import {createOwnerDeployment} from '../public/wallet-execution-model.js';

const review=await validateSigningReview(readFileSync(new URL('../public/wallet-signing-review.json',import.meta.url)));
const clone=value=>structuredClone(value),hash=char=>'0x'+char.repeat(64),q=value=>'0x'+BigInt(value).toString(16),submittedHash=hash('a');
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
const sha=value=>createHash('sha256').update(canonical(value)).digest('hex');
const failure=(code)=>Object.assign(Error('Offline fixture failure'),{code});
function approvedPolicy(){return {...clone(WALLET_EXECUTION_POLICY),status:'APPROVED_FOR_OWNER_WALLET',submissionAllowed:true,issuerPolicySigned:true,ownerApproved:true,reviewEvidenceVerified:true,reviews:WALLET_EXECUTION_POLICY.reviews.map(({id})=>({id,verified:true,evidenceSha256:'d'.repeat(64)})),blockers:[]};}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
const commitment=draft=>Object.fromEntries(['chainId','genesisHash','from','nonce','gasLimit','gasPrice','maximumFeeBaseUnits','creationSha256'].map(key=>[key,draft[key]]));
class Wallet extends EventEmitter{
 constructor(){super();this.calls=[];this.accounts=[SIGNING_PINS.sender];this.chain=q(SIGNING_PINS.chainId);this.genesis={number:'0x0',hash:SIGNING_PINS.genesisHash};this.nonce='0x3';this.gas=q(5000000);this.price='0x11';this.balance=q(100000000);this.overrides={};this.before=null;this.transactions=new Map();this.receipt=null;this.blocks=new Map();this.code='0x';this.callResults=new Map();}
 async request({method,params}){
  this.calls.push(clone({method,params}));this.before?.(method,params);
  if(this.overrides[method])return this.overrides[method](params);
  switch(method){
   case 'eth_requestAccounts':case 'eth_accounts':return [...this.accounts];
   case 'eth_chainId':return this.chain;
   case 'eth_getBlockByNumber':return params[0]==='0x0'?clone(this.genesis):clone(this.blocks.get(params[0]));
   case 'eth_getTransactionCount':return this.nonce;
   case 'eth_estimateGas':return this.gas;
   case 'eth_gasPrice':return this.price;
   case 'eth_getBalance':return this.balance;
   case 'eth_sendTransaction':return submittedHash;
   case 'eth_getTransactionByHash':return clone(this.transactions.get(params[0].toLowerCase())??null);
   case 'eth_getTransactionReceipt':return clone(this.receipt);
   case 'eth_getCode':return this.code;
   case 'eth_call':return this.callResults.get(params[0].data);
   default:throw Error('Unexpected provider method '+method);
  }
 }
 sends(){return this.calls.filter(call=>call.method==='eth_sendTransaction');}
}
function setup(t,options={}){
 const provider=options.provider??new Wallet(),policy=options.policy??approvedPolicy(),calls={read:0,claim:[],report:[]},changes=[];
 let clock=100000,saved=options.saved??null,serverPolicy=clone(policy),submissionAllowed=walletExecutionAuthorized(policy),client;
 const readIntent=async()=>{calls.read++;return options.readIntent?options.readIntent():{record:clone(saved),policy:clone(serverPolicy),submissionAllowed};};
 const claimIntent=async body=>{
  calls.claim.push(clone(body));if(options.claimIntent)return options.claimIntent(body);
  const fresh=saved===null;if(fresh)saved={schema:'numina.nusd.deployment-intent.v1',attemptId:body.attemptId,transaction:clone(body.transaction),reportedTransactionHash:null};
  return {fresh,record:clone(saved),transactionCommitment:sha(saved.transaction)};
 };
 const reportHash=async body=>{calls.report.push(clone(body));if(options.reportHash)return options.reportHash(body);if(saved)saved.reportedTransactionHash=body.transactionHash;return {record:clone(saved)};};
 client=createOwnerDeployment({provider,review,policy,readIntent,claimIntent,reportHash,makeId:()=>options.attemptId??'offline-attempt-1',now:()=>clock,timeoutMs:options.timeoutMs??1000,onChange:snapshot=>{changes.push(snapshot);options.onChange?.(snapshot,client,provider);}});
 t.after(()=>client.dispose());return {provider,client,policy,calls,changes,setClock:value=>{clock=value;},setSaved:value=>{saved=value;},saved:()=>clone(saved),server:(value,allowed=true)=>{serverPolicy=value;submissionAllowed=allowed;}};
}
async function prepared(t,options){const h=setup(t,options);await h.client.connect();h.draft=await h.client.prepare();return h;}
function txFor(draft,value=submittedHash){return {hash:value,from:draft.from,chainId:q(draft.chainId),nonce:q(draft.nonce),to:null,value:'0x0',input:draft.data,type:'0x0',gas:q(draft.gasLimit),gasPrice:q(draft.gasPrice),blockHash:hash('b'),blockNumber:q(100),transactionIndex:'0x0'};}
function savedFor(draft,reportedTransactionHash=null){return {schema:'numina.nusd.deployment-intent.v1',attemptId:draft.attemptId,transaction:commitment(draft),reportedTransactionHash};}
async function claimedUnknown(t,options={}){const h=await prepared(t,{...options,claimIntent:async()=>{throw failure('REQUEST_TIMEOUT');}});await assert.rejects(h.client.submit(h.draft),{code:'REQUEST_TIMEOUT'});h.setSaved(savedFor(h.draft));return h;}
function installReceipt(h,confirmations=12){
 const artifact=JSON.parse(readFileSync(new URL('../runtime/nusd/reviews/uncapped-500t/artifacts/NuminaUSD.json',import.meta.url))),iface=new Interface(artifact.abi),contract=getCreateAddress({from:h.draft.from,nonce:BigInt(h.draft.nonce)}),blockHash=hash('b');
 const runtime=Buffer.from(artifact.deployedBytecode.slice(2),'hex');for(const entry of artifact.runtimeImmutables)for(const ref of entry.references)Buffer.from(SIGNING_PINS.policy,'hex').copy(runtime,ref.start);
 const log={...iface.encodeEventLog(iface.getEvent('Transfer'),[ZeroAddress,h.draft.from,BigInt(SIGNING_PINS.initialSupplyBaseUnits)]),address:contract,removed:false,transactionHash:submittedHash,blockHash,blockNumber:q(100),transactionIndex:'0x0',logIndex:'0x1'};
 h.provider.transactions.set(submittedHash,txFor(h.draft));h.provider.receipt={status:'0x1',type:'0x0',transactionHash:submittedHash,contractAddress:contract,from:h.draft.from,to:null,gasUsed:q(4000000),effectiveGasPrice:q(17),cumulativeGasUsed:q(4000000),blockHash,blockNumber:q(100),transactionIndex:'0x0',logs:[log]};
 h.provider.blocks.set(q(100),{number:q(100),hash:blockHash,transactions:[submittedHash]});h.provider.blocks.set('latest',{number:q(99+confirmations),hash:hash('c')});h.provider.code='0x'+runtime.toString('hex');for(const call of RECEIPT_CALLS)h.provider.callResults.set(call.data,call.expectedResult);
}

test('source BLOCKED policy prevents any durable claim, hash write or wallet send',async t=>{
 assert.equal(WALLET_EXECUTION_POLICY.status,'BLOCKED');assert.equal(walletExecutionAuthorized(),false);
 const h=await prepared(t,{policy:WALLET_EXECUTION_POLICY});assert.equal(h.client.snapshot().submissionAllowed,false);
 await assert.rejects(h.client.submit(h.draft),{code:'DEPLOYMENT_REVIEWS_REQUIRED'});assert.equal(h.calls.claim.length,0);assert.equal(h.calls.report.length,0);assert.equal(h.provider.sends().length,0);assert.equal(h.client.snapshot().attempted,false);
});

test('constructor rejects unvalidated review, unsupported provider and invalid deadlines without requesting a wallet',()=>{
 const provider=new Wallet();assert.throws(()=>createOwnerDeployment({provider,review:clone(review)}),{code:'UNTRUSTED_REVIEW'});
 assert.throws(()=>createOwnerDeployment({provider:{request(){}},review}),{code:'WALLET_UNAVAILABLE'});
 for(const timeoutMs of [0,-1,Infinity,120001])assert.throws(()=>createOwnerDeployment({provider,review,timeoutMs}),{code:'INVALID_CONFIGURATION'});assert.equal(provider.calls.length,0);
});

test('prepare preserves exact pinned creation, account, nonce and fee values and does not claim or send',async t=>{
 const h=await prepared(t);assert.equal(h.draft.nonce,'3');assert.equal(h.draft.gasLimit,'5000000');assert.equal(h.draft.gasPrice,'17');assert.equal(h.draft.maximumFeeBaseUnits,'85000000');assert.equal(h.draft.data,review.constructorData);assert.equal(h.draft.genesisHash,SIGNING_PINS.genesisHash);assert.equal(h.draft.to,null);assert.equal(h.draft.value,'0');
 const {draftSha256,...value}=h.draft;assert.equal(draftSha256,sha(value));assert.equal(Object.isFrozen(h.draft),true);assert.equal(h.client.snapshot().status,'REVIEW_READY');assert.equal(h.calls.claim.length,0);assert.equal(h.provider.sends().length,0);
 assert.equal(h.provider.calls.filter(call=>call.method==='eth_requestAccounts').length,1);
});

test('account approval notification is followed by a complete identity read',async t=>{
 const h=setup(t);h.provider.before=method=>{if(method==='eth_requestAccounts')h.provider.emit('accountsChanged',[SIGNING_PINS.sender]);};await h.client.connect();assert.equal(h.client.snapshot().status,'CONNECTED');assert.equal(h.provider.calls.at(-1).method,'eth_getBlockByNumber');
});

for(const [name,mutate,error] of [
 ['wrong chain',p=>p.chain='0x1','WALLET_IDENTITY_MISMATCH'],
 ['wrong first account',p=>p.accounts=['0x'+'1'.repeat(40),SIGNING_PINS.sender],'WALLET_IDENTITY_MISMATCH'],
 ['wrong genesis',p=>p.genesis.hash=hash('d'),'GENESIS_MISMATCH'],
 ['nonce overflow',p=>p.nonce=q((1n<<64n)-1n),'NONCE_OUT_OF_RANGE'],
 ['noncanonical nonce',p=>p.nonce='0x00','INVALID_RPC_QUANTITY'],
 ['zero gas',p=>p.gas='0x0','FEE_BUDGET_EXCEEDED'],
 ['fee multiplication overflow',p=>{p.gas='0x'+'f'.repeat(64);p.price='0x2';},'FEE_BUDGET_EXCEEDED'],
 ['insufficient balance',p=>p.balance='0x1','FEE_BUDGET_EXCEEDED']
])test('prepare rejects '+name,async t=>{const h=setup(t);mutate(h.provider);await assert.rejects(h.client.prepare(),{code:error});assert.equal(h.calls.claim.length,0);assert.equal(h.provider.sends().length,0);assert.equal(h.client.snapshot().candidate,null);});

test('budget parsing is exact; large integers and legitimate zero-priced gas remain representable',async t=>{
 for(const bad of [null,85000000,'085000000','8.5e7','-1','1.1',(1n<<256n).toString()]){const h=setup(t);await assert.rejects(h.client.prepare({maximumFeeBaseUnits:bad}),{code:'INVALID_FEE_LIMIT'});}
 for(const bad of ['84999999','100000001']){const h=setup(t);await assert.rejects(h.client.prepare({maximumFeeBaseUnits:bad}),{code:'FEE_BUDGET_EXCEEDED'});}
 const h=setup(t);h.provider.gas=q(9007199254740993n);h.provider.price='0x3';h.provider.balance='0xffffffffffffffff';assert.equal((await h.client.prepare()).maximumFeeBaseUnits,'27021597764222979');
 const zero=setup(t);zero.provider.price='0x0';zero.provider.balance='0x0';assert.equal((await zero.client.prepare()).maximumFeeBaseUnits,'0');
});

for(const mode of ['server_blocked','policy_mismatch'])test('submit fails closed for '+mode,async t=>{
 const h=await prepared(t);h.server(mode==='policy_mismatch'?{...h.policy,ownerApproved:false}:h.policy,mode!=='server_blocked');
 await assert.rejects(h.client.submit(h.draft),{code:'DEPLOYMENT_REVIEWS_REQUIRED'});assert.equal(h.calls.claim.length,0);assert.equal(h.provider.sends().length,0);
});

test('expired, backwards-clock and copied drafts cannot be submitted',async t=>{
 const h=await prepared(t);await assert.rejects(h.client.submit(clone(h.draft)),{code:'INVALID_OR_ATTEMPTED_DRAFT'});
 h.setClock(99999);await assert.rejects(h.client.submit(h.draft),{code:'QUOTE_EXPIRED'});h.setClock(160000);await assert.rejects(h.client.submit(h.draft),{code:'QUOTE_EXPIRED'});assert.equal(h.calls.claim.length,0);assert.equal(h.provider.sends().length,0);
});

for(const [name,mutate,error] of [
 ['nonce change',p=>p.nonce='0x4','NONCE_CHANGED'],
 ['larger gas estimate',p=>p.gas=q(5000001),'ESTIMATE_CHANGED'],
 ['higher gas price',p=>p.price='0x12','ESTIMATE_CHANGED'],
 ['lower native balance',p=>p.balance='0x1','ESTIMATE_CHANGED'],
 ['wrong network',p=>p.chain='0x1','WALLET_IDENTITY_MISMATCH']
])test('submit rechecks '+name+' before retaining a claim',async t=>{const h=await prepared(t);mutate(h.provider);await assert.rejects(h.client.submit(h.draft),{code:error});assert.equal(h.calls.claim.length,0);assert.equal(h.provider.sends().length,0);});

test('one fresh matching durable claim permits exactly one explicit send with reviewed fields',async t=>{
 const h=await prepared(t),result=await h.client.submit(h.draft);assert.equal(result.status,'SUBMITTED');assert.equal(result.transactionHash,submittedHash);assert.equal(result.attempted,true);assert.equal(result.hashSaved,true);assert.equal(result.error,null);
 assert.deepEqual(h.calls.claim,[{action:'claim',attemptId:h.draft.attemptId,transaction:commitment(h.draft)}]);
 assert.deepEqual(h.provider.sends(),[{method:'eth_sendTransaction',params:[{type:'0x0',chainId:q(h.draft.chainId),from:h.draft.from,nonce:q(h.draft.nonce),gas:q(h.draft.gasLimit),gasPrice:q(h.draft.gasPrice),value:'0x0',data:h.draft.data}]}]);
 assert.deepEqual(h.calls.report,[{action:'report_hash',attemptId:h.draft.attemptId,transactionHash:submittedHash}]);
 await assert.rejects(h.client.submit(h.draft),{code:'INVALID_OR_ATTEMPTED_DRAFT'});await assert.rejects(h.client.prepare(),{code:'ATTEMPT_ALREADY_EXISTS'});assert.equal(h.provider.sends().length,1);
});

for(const mode of ['replayed','wrong_attempt','wrong_transaction','wrong_commitment','claim_timeout'])test('a '+mode+' claim cannot dispatch and cannot be replaced',async t=>{
 let draft;const h=await prepared(t,{claimIntent:async()=>{if(mode==='claim_timeout')throw failure('REQUEST_TIMEOUT');const record=savedFor(draft);if(mode==='wrong_attempt')record.attemptId='different';if(mode==='wrong_transaction')record.transaction.gasPrice='18';return {fresh:mode!=='replayed',record,transactionCommitment:mode==='wrong_commitment'?'0'.repeat(64):sha(commitment(draft))};}});draft=h.draft;
 await assert.rejects(h.client.submit(draft),{code:mode==='claim_timeout'?'REQUEST_TIMEOUT':'INTENT_NOT_NEW'});assert.equal(h.client.snapshot().attempted,true);assert.equal(h.provider.sends().length,0);
 await assert.rejects(h.client.submit(draft),{code:'INVALID_OR_ATTEMPTED_DRAFT'});await assert.rejects(h.client.prepare(),{code:'ATTEMPT_ALREADY_EXISTS'});assert.equal(h.calls.claim.length,1);
});

test('a saved claim found by a second controller blocks a second wallet request',async t=>{
 const first=await prepared(t);await first.client.submit(first.draft);const second=setup(t,{saved:first.saved()});await second.client.connect();
 assert.equal(second.client.snapshot().attempted,true);assert.equal(second.client.snapshot().transactionHash,submittedHash);assert.equal(second.client.snapshot().candidate.data,review.constructorData);assert.equal(second.client.snapshot().hashSaved,true);
 await assert.rejects(second.client.prepare(),{code:'ATTEMPT_ALREADY_EXISTS'});await assert.rejects(second.client.submit(second.client.snapshot().candidate),{code:'INVALID_OR_ATTEMPTED_DRAFT'});assert.equal(second.calls.claim.length,0);assert.equal(second.provider.sends().length,0);
});

test('nonce change after durable claim retains uncertainty and sends nothing',async t=>{
 let h;h=await prepared(t,{claimIntent:async body=>{h.provider.nonce='0x4';return {fresh:true,record:savedFor(h.draft),transactionCommitment:sha(body.transaction)};}});
 await assert.rejects(h.client.submit(h.draft),{code:'PRE_SUBMISSION_CHANGED'});assert.equal(h.client.snapshot().attempted,true);assert.equal(h.provider.sends().length,0);
});

test('duplicate clicks during a pending wallet prompt issue exactly one send',async t=>{
 const pending=deferred(),h=await prepared(t);h.provider.overrides.eth_sendTransaction=()=>pending.promise;const sending=h.client.submit(h.draft);
 while(h.provider.sends().length===0)await nextTurn();await assert.rejects(h.client.submit(h.draft),{code:'WALLET_BUSY'});await assert.rejects(h.client.prepare(),{code:'WALLET_BUSY'});
 pending.resolve(submittedHash);await sending;assert.equal(h.provider.sends().length,1);
});

for(const mode of ['timeout_then_hash','timeout_then_rejection','rejection','bad_hash'])test('wallet '+mode+' retains the attempted intent and never automatically resends',async t=>{
 const h=await prepared(t,{timeoutMs:15}),pending=deferred();h.provider.overrides.eth_sendTransaction=()=>mode.startsWith('timeout')?pending.promise:mode==='rejection'?Promise.reject(failure(4001)):Promise.resolve('invalid');
 await assert.rejects(h.client.submit(h.draft),{code:mode.startsWith('timeout')?'WALLET_TIMEOUT':mode==='rejection'?4001:'INVALID_TRANSACTION_HASH'});
 assert.equal(h.client.snapshot().attempted,true);assert.equal(h.provider.sends().length,1);assert.equal(h.client.snapshot().status,mode==='rejection'?'WALLET_DECLINED':'OUTCOME_UNKNOWN');
 if(mode==='timeout_then_hash'){pending.resolve(submittedHash);await nextTurn();assert.equal(h.client.snapshot().transactionHash,submittedHash);assert.equal(h.client.snapshot().status,'SUBMITTED');assert.equal(h.client.snapshot().hashSaved,false);assert.equal(h.client.snapshot().error,'HASH_NOT_SAVED');assert.equal(h.calls.report.length,0);}
 if(mode==='timeout_then_rejection'){pending.reject(failure(4001));await nextTurn();assert.equal(h.client.snapshot().transactionHash,null);}
 await assert.rejects(h.client.submit(h.draft),{code:'INVALID_OR_ATTEMPTED_DRAFT'});await assert.rejects(h.client.prepare(),{code:'ATTEMPT_ALREADY_EXISTS'});assert.equal(h.provider.sends().length,1);
});

test('hash reporting failure preserves the public transaction hash for reconciliation',async t=>{
 const h=await prepared(t,{reportHash:async()=>{throw failure('REQUEST_TIMEOUT');}});const result=await h.client.submit(h.draft);assert.equal(result.transactionHash,submittedHash);assert.equal(result.error,'HASH_NOT_SAVED');assert.equal(result.hashSaved,false);assert.equal(result.status,'SUBMITTED');assert.equal(h.provider.sends().length,1);
});

for(const [name,change] of [
 ['no record',()=>null],
 ['wrong schema',record=>({...record,schema:'unrelated.record'})],
 ['wrong attempt',record=>({...record,attemptId:'other-attempt'})],
 ['wrong exact transaction',record=>({...record,transaction:{...record.transaction,nonce:'4'}})],
 ['wrong hash',record=>({...record,reportedTransactionHash:hash('f')})],
 ['missing hash',record=>({...record,reportedTransactionHash:null})]
])test('resolved report with '+name+' cannot claim the hash was saved',async t=>{
 let h;h=await prepared(t,{reportHash:async()=>({record:change(savedFor(h.draft,submittedHash))})});
 const result=await h.client.submit(h.draft);assert.equal(result.status,'SUBMITTED');assert.equal(result.transactionHash,submittedHash);assert.equal(result.hashSaved,false);assert.equal(result.error,'HASH_NOT_SAVED');assert.equal(h.provider.sends().length,1);
});

test('hashSaved stays false while reporting and becomes true only after the exact record returns',async t=>{
 const pending=deferred();const h=await prepared(t,{reportHash:()=>pending.promise});const sending=h.client.submit(h.draft);
 while(h.calls.report.length===0)await nextTurn();assert.equal(h.client.snapshot().transactionHash,submittedHash);assert.equal(h.client.snapshot().hashSaved,false);
 pending.resolve({record:savedFor(h.draft,submittedHash)});assert.equal((await sending).hashSaved,true);assert.equal(h.client.snapshot().error,null);
});

test('late reporting response after its deadline cannot mark the local hash saved',async t=>{
 const pending=deferred(),h=await prepared(t,{timeoutMs:15,reportHash:()=>pending.promise});const result=await h.client.submit(h.draft);
 assert.equal(result.hashSaved,false);assert.equal(result.error,'HASH_NOT_SAVED');pending.resolve({record:savedFor(h.draft,submittedHash)});await nextTurn();assert.equal(h.client.snapshot().hashSaved,false);assert.equal(h.calls.report.length,1);
});

test('reconnecting preserves an unsaved local hash and recognizes it only when the matching saved record appears',async t=>{
 const h=await prepared(t,{reportHash:async()=>{throw failure('REQUEST_TIMEOUT');}});await h.client.submit(h.draft);
 await h.client.connect();assert.equal(h.client.snapshot().transactionHash,submittedHash);assert.equal(h.client.snapshot().hashSaved,false);assert.equal(h.client.snapshot().error,'HASH_NOT_SAVED');
 h.setSaved(savedFor(h.draft,submittedHash));await h.client.connect();assert.equal(h.client.snapshot().transactionHash,submittedHash);assert.equal(h.client.snapshot().hashSaved,true);assert.equal(h.client.snapshot().error,null);assert.equal(h.provider.sends().length,1);
});

test('a conflicting saved record cannot replace the locally observed transaction hash',async t=>{
 const h=await prepared(t,{reportHash:async()=>{throw failure('REQUEST_TIMEOUT');}});await h.client.submit(h.draft);h.setSaved(savedFor(h.draft,hash('f')));
 await assert.rejects(h.client.connect(),{code:'INVALID_SAVED_INTENT'});assert.equal(h.client.snapshot().transactionHash,submittedHash);assert.equal(h.client.snapshot().hashSaved,false);
});

test('adoption requires exact server acknowledgment before exposing hashSaved true',async t=>{
 const h=await claimedUnknown(t,{reportHash:async()=>({ok:true})});h.provider.transactions.set(submittedHash,txFor(h.draft));
 await assert.rejects(h.client.adoptHash(submittedHash),{code:'HASH_NOT_SAVED'});assert.equal(h.client.snapshot().transactionHash,submittedHash);assert.equal(h.client.snapshot().hashSaved,false);assert.equal(h.client.snapshot().error,'HASH_NOT_SAVED');assert.equal(h.provider.sends().length,0);
});

for(const mutation of [record=>record.transaction.from='0x'+'1'.repeat(40),record=>record.transaction.chainId='1',record=>record.transaction.genesisHash=hash('d'),record=>record.transaction.creationSha256='d'.repeat(64),record=>record.transaction.gasLimit='0'])test('restore rejects a mismatched retained intent',async t=>{
 const first=await prepared(t),record=savedFor(first.draft);mutation(record);const h=setup(t,{saved:record});await assert.rejects(h.client.connect(),{code:'INVALID_SAVED_INTENT'});assert.equal(h.provider.sends().length,0);assert.equal(h.calls.claim.length,0);
});

test('adoptHash requires a retained attempt and matches all transaction identity fields before reporting',async t=>{
 const before=await prepared(t);await assert.rejects(before.client.adoptHash(submittedHash),{code:'SAVED_INTENT_REQUIRED'});
 const h=await claimedUnknown(t),tx=txFor(h.draft);h.provider.transactions.set(submittedHash,tx);const result=await h.client.adoptHash(submittedHash.toUpperCase().replace('0X','0x'));assert.equal(result.transactionHash,submittedHash);assert.equal(result.status,'SUBMITTED');assert.equal(result.hashSaved,true);assert.equal(h.provider.sends().length,0);assert.equal(h.calls.report.length,1);
 const other=hash('f');h.provider.transactions.set(other,txFor(h.draft,other));await assert.rejects(h.client.adoptHash(other),{code:'TRANSACTION_HASH_CONFLICT'});assert.equal(h.calls.report.length,1);assert.equal(h.client.snapshot().transactionHash,submittedHash);
});

for(const [name,change] of [['sender',tx=>tx.from='0x'+'1'.repeat(40)],['chain',tx=>tx.chainId='0x1'],['nonce',tx=>tx.nonce='0x4'],['creation',tx=>tx.input='0x00'],['value',tx=>tx.value='0x1'],['destination',tx=>tx.to='0x'+'1'.repeat(40)],['gas',tx=>tx.gas='0x1'],['price',tx=>tx.gasPrice='0x1'],['type',tx=>tx.type='0x2']])test('adoptHash rejects mismatched '+name,async t=>{
 const h=await claimedUnknown(t),tx=txFor(h.draft);change(tx);h.provider.transactions.set(submittedHash,tx);await assert.rejects(h.client.adoptHash(submittedHash),{code:'TRANSACTION_MISMATCH'});assert.equal(h.calls.report.length,0);assert.equal(h.client.snapshot().transactionHash,null);
});

for(const event of ['accountsChanged','chainChanged','disconnect'])test(event+' invalidates an unattempted review and blocks a late read',async t=>{
 const h=await prepared(t);h.provider.emit(event);assert.equal(h.client.snapshot().status,'IDLE');assert.equal(h.client.snapshot().candidate,null);await assert.rejects(h.client.submit(h.draft),{code:'INVALID_OR_ATTEMPTED_DRAFT'});
 const pending=deferred();h.provider.overrides.eth_estimateGas=()=>pending.promise;const preparing=h.client.prepare();while(!h.provider.calls.filter(call=>call.method==='eth_estimateGas').length||h.client.snapshot().busy!==true)await nextTurn();await nextTurn();h.provider.emit(event);pending.resolve(q(5000000));await assert.rejects(preparing,{code:'WALLET_CHANGED'});assert.equal(h.client.snapshot().candidate,null);assert.equal(h.provider.sends().length,0);
});

for(const mode of ['dispose','invalidate'])test(mode+' immediately before dispatch prevents the wallet write',async t=>{
 const h=await prepared(t,{onChange:(state,client,provider)=>{if(state.status==='AWAITING_WALLET'){if(mode==='dispose')client.dispose();else provider.emit('chainChanged');}}});
 await assert.rejects(h.client.submit(h.draft),{code:'WALLET_CHANGED'});assert.equal(h.provider.sends().length,0);assert.equal(h.client.snapshot().attempted,true);
});

test('disposal removes listeners and suppresses notifications but retains a late submitted hash',async t=>{
 const h=await prepared(t),pending=deferred();h.provider.overrides.eth_sendTransaction=()=>pending.promise;const sending=h.client.submit(h.draft);while(h.provider.sends().length===0)await nextTurn();h.client.dispose();const count=h.changes.length;
 for(const event of ['accountsChanged','chainChanged','disconnect'])assert.equal(h.provider.listenerCount(event),0);
 pending.resolve(submittedHash);await sending;assert.equal(h.changes.length,count);assert.equal(h.client.snapshot().transactionHash,submittedHash);assert.equal(h.calls.report.length,0);assert.equal(h.provider.sends().length,1);
});

test('receipt reads are bound to the receipt block, use exact getter calls and never send again',async t=>{
 const h=await prepared(t);await h.client.submit(h.draft);installReceipt(h);const result=await h.client.checkReceipt();assert.equal(result.status,'RECEIPT_VERIFIED',JSON.stringify(result.verification));assert.equal(result.verification.valid,true);
 const calls=h.provider.calls.filter(call=>call.method==='eth_call');assert.equal(calls.length,RECEIPT_CALLS.length);for(const call of calls)assert.deepEqual(call.params[1],{blockHash:hash('b'),requireCanonical:true});assert.equal(h.provider.sends().length,1);
});

test('receipt verification respects a stricter source-approved confirmation policy',async t=>{
 const policy=approvedPolicy();policy.minimumConfirmations=24;const h=await prepared(t,{policy});await h.client.submit(h.draft);installReceipt(h,12);const result=await h.client.checkReceipt();assert.equal(result.status,'RECEIPT_UNVERIFIED');assert.equal(result.verification.valid,false);
});

test('wallet invalidation while receipt hashing is pending cannot install a late verification',async t=>{
 const h=await prepared(t);await h.client.submit(h.draft);installReceipt(h);
 const entered=deferred(),release=deferred(),original=crypto.subtle.digest;
 crypto.subtle.digest=async function(...args){entered.resolve();await release.promise;return original.apply(this,args);};
 t.after(()=>{crypto.subtle.digest=original;});
 const checking=h.client.checkReceipt();await entered.promise;h.provider.emit('chainChanged');release.resolve();
 await assert.rejects(checking,{code:'WALLET_CHANGED'});assert.equal(h.client.snapshot().verification,null);assert.notEqual(h.client.snapshot().status,'RECEIPT_VERIFIED');
 crypto.subtle.digest=original;
});

test('pending, reverted and inconsistent receipts remain distinct from verified deployment',async t=>{
 const h=await prepared(t);await h.client.submit(h.draft);assert.equal((await h.client.checkReceipt()).status,'PENDING');h.provider.receipt={status:'0x0'};assert.equal((await h.client.checkReceipt()).status,'REVERTED');installReceipt(h,11);assert.equal((await h.client.checkReceipt()).status,'RECEIPT_UNVERIFIED');assert.equal(h.provider.sends().length,1);
});
