import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Interface,getCreateAddress,id,ZeroHash,ZeroAddress} from '../public/vendor/ethers-6.15.0.min.js';
import {SIGNING_PINS} from '../public/wallet-signing-model.js';
import {EXPECTED_RUNTIME_SHA256,EXPECTED_RUNTIME_BYTES,MINIMUM_CONFIRMATIONS,RECEIPT_CALLS,expectedDeploymentAddress,verifyOwnerDeploymentReceipt} from '../public/wallet-execution-receipt.js';

const artifactBytes=readFileSync(new URL('../runtime/nusd/reviews/uncapped-500t/artifacts/NuminaUSD.json',import.meta.url));
const artifact=JSON.parse(artifactBytes),reviewBytes=readFileSync(new URL('../public/wallet-signing-review.json',import.meta.url)),review=JSON.parse(reviewBytes),iface=new Interface(artifact.abi);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),q=value=>'0x'+BigInt(value).toString(16),hash=character=>'0x'+character.repeat(64);
function patchedRuntime(policy=review.constructor.approvedIssuerPolicyHash){
 const code=Buffer.from(artifact.deployedBytecode.slice(2),'hex');
 for(const item of artifact.runtimeImmutables)for(const ref of item.references)Buffer.from(policy.slice(2),'hex').copy(code,ref.start);
 return '0x'+code.toString('hex');
}
function getterCalls(){
 const c=review.constructor;
 const values=[['name',[],'Numina USD'],['symbol',[],'NUSD'],['decimals',[],6n],['paused',[],true],['totalSupply',[],BigInt(c.initialSupplyBaseUnits)],['balanceOf',[c.initialRecipient],BigInt(c.initialSupplyBaseUnits)],['authorizedSupply',[],0n],['issuerPolicyHash',[],c.approvedIssuerPolicyHash],['defaultAdmin',[],c.admin],['defaultAdminDelay',[],BigInt(c.adminDelaySeconds)],...[[ZeroHash,c.admin],[id('ISSUER_ROLE'),c.issuer],[id('MINTER_ROLE'),c.minter],[id('PAUSER_ROLE'),c.pauser]].map(args=>['hasRole',args,true])];
 return values.map(([name,args,result])=>({data:iface.encodeFunctionData(name,args),result:iface.encodeFunctionResult(name,[result])}));
}
function evidence(){
 const candidate={submittedHash:hash('a'),chainId:SIGNING_PINS.chainId,genesisHash:SIGNING_PINS.genesisHash,from:SIGNING_PINS.sender,nonce:'128',gasLimit:'5000000',gasPrice:'17',maximumFeeBaseUnits:'85000000',value:'0',to:null,data:review.constructorData};
 const contract=getCreateAddress({from:candidate.from,nonce:BigInt(candidate.nonce)}),blockHash=hash('b');
 const transaction={hash:candidate.submittedHash,from:candidate.from,chainId:q(candidate.chainId),nonce:q(candidate.nonce),to:null,value:'0x0',input:candidate.data,type:'0x0',gas:q(candidate.gasLimit),gasPrice:q(candidate.gasPrice),blockHash,blockNumber:q(100),transactionIndex:'0x0'};
 const log={...iface.encodeEventLog(iface.getEvent('Transfer'),[ZeroAddress,candidate.from,BigInt(SIGNING_PINS.initialSupplyBaseUnits)]),address:contract,removed:false,transactionHash:candidate.submittedHash,blockHash,blockNumber:q(100),transactionIndex:'0x0',logIndex:'0x2'};
 const receipt={status:'0x1',type:'0x0',transactionHash:candidate.submittedHash,contractAddress:contract,from:candidate.from,to:null,gasUsed:q(4000000),effectiveGasPrice:q(17),cumulativeGasUsed:q(4200000),blockHash,blockNumber:q(100),transactionIndex:'0x0',logs:[log]};
 const canonicalBlock={hash:blockHash,number:q(100),transactions:[candidate.submittedHash]};
 return {candidate,transaction,receipt,canonicalBlock,headBlock:{hash:hash('c'),number:q(111)},finalBlockReread:{hash:blockHash,number:q(100)},runtimeCode:{address:contract,blockHash,code:patchedRuntime()},calls:getterCalls().map(call=>({...call,to:contract,blockHash}))};
}
async function rejects(change,expected){const data=evidence();change(data);const result=await verifyOwnerDeploymentReceipt(data);assert.equal(result.valid,false);assert.equal(result.candidateDeployment,null);assert.equal(result.status,'EVIDENCE_INCOMPLETE_OR_INCONSISTENT');if(expected)assert.ok(result.errors.includes(expected),JSON.stringify(result.errors));return result;}

test('runtime and every call constant derive exactly from the pinned v3 artifact and revised 1500T review',()=>{
 assert.equal(sha(artifactBytes),SIGNING_PINS.artifact);assert.equal(sha(reviewBytes),SIGNING_PINS.review);
 assert.deepEqual(artifact.runtimeImmutables,[{astId:39,sourceName:'contracts/NuminaUSD.sol',contractName:'NuminaUSD',variableName:'issuerPolicyHash',references:[{length:32,start:1086}]}]);
 const runtime=Buffer.from(patchedRuntime().slice(2),'hex');assert.equal(runtime.length,EXPECTED_RUNTIME_BYTES);assert.equal(sha(runtime),EXPECTED_RUNTIME_SHA256);
 assert.equal(MINIMUM_CONFIRMATIONS,12);assert.deepEqual(RECEIPT_CALLS.map(call=>({data:call.data,result:call.expectedResult})),getterCalls());
 assert.ok(Object.isFrozen(RECEIPT_CALLS));assert.ok(RECEIPT_CALLS.every(Object.isFrozen));
});

test('CREATE address matches the independent reviewed encoder across RLP nonce boundaries',()=>{
 for(const sender of [SIGNING_PINS.sender,'0x1111111111111111111111111111111111111111'])for(const nonce of [0n,1n,127n,128n,255n,256n,65535n,65536n,9007199254740993n,(1n<<64n)-2n,(1n<<128n)])assert.equal(expectedDeploymentAddress(sender,nonce.toString()),getCreateAddress({from:sender,nonce}).toLowerCase());
 for(const nonce of ['-1','1.5','01',1,((1n<<256n)).toString()])assert.throws(()=>expectedDeploymentAddress(SIGNING_PINS.sender,nonce));
});

test('consistent deployment evidence yields a frozen provider observation without fund, deposit or journal claims',async()=>{
 const data=evidence(),result=await verifyOwnerDeploymentReceipt(data);
 assert.equal(result.valid,true,JSON.stringify(result.errors));assert.equal(result.status,'CONSISTENT_PROVIDER_OBSERVATION');assert.equal(result.verification,'provider_observation');assert.equal(result.scope,'supplied_evidence_consistency_only');
 assert.equal(result.candidateDeployment.address,data.receipt.contractAddress.toLowerCase());assert.equal(result.candidateDeployment.confirmations,'12');assert.equal(result.candidateDeployment.supplyBaseUnits,'1500000000000000000000');assert.equal(result.candidateDeployment.observedFeeBaseUnits,'68000000');
 for(const flag of ['independentNetworkVerification','signingControlVerified','fundsVerified','reservesVerified','settlementVerified','productionMetadataUpdated','nativeJournalWritten','depositPerformed'])assert.equal(result[flag],false);
 assert.ok(Object.isFrozen(result));assert.ok(Object.isFrozen(result.errors));assert.ok(Object.isFrozen(result.candidateDeployment));
 assert.throws(()=>{result.candidateDeployment.supplyBaseUnits='1';},TypeError);
});

for(const [name,change,error] of [
 ['different sender',e=>e.candidate.from='0x1111111111111111111111111111111111111111','CANDIDATE_IDENTITY'],
 ['different chain',e=>e.candidate.chainId='1','CANDIDATE_IDENTITY'],
 ['different genesis',e=>e.candidate.genesisHash=hash('d'),'CANDIDATE_IDENTITY'],
 ['missing submission hash',e=>e.candidate.submittedHash=null,'SUBMITTED_HASH'],
 ['nonzero value',e=>e.candidate.value='1','CANDIDATE_DEPLOYMENT'],
 ['contract call instead of creation',e=>e.candidate.to=e.receipt.contractAddress,'CANDIDATE_DEPLOYMENT'],
 ['changed creation bytes',e=>e.candidate.data=e.candidate.data.slice(0,-2)+'00','CANDIDATE_CREATION_HASH'],
 ['over-budget gas',e=>e.candidate.maximumFeeBaseUnits='84999999','CANDIDATE_FEE_BUDGET'],
 ['wrong transaction hash',e=>e.transaction.hash=hash('d'),'TRANSACTION_HASH'],
 ['wrong transaction sender',e=>e.transaction.from='0x1111111111111111111111111111111111111111','TRANSACTION_IDENTITY'],
 ['wrong transaction chain',e=>e.transaction.chainId='0x1','TRANSACTION_IDENTITY'],
 ['wrong nonce',e=>e.transaction.nonce='0x81','TRANSACTION_IDENTITY'],
 ['different transaction input',e=>e.transaction.input='0x00','TRANSACTION_CREATION'],
 ['different gas limit',e=>e.transaction.gas='0x1','TRANSACTION_FEES'],
 ['different gas price',e=>e.transaction.gasPrice='0x1','TRANSACTION_FEES'],
 ['different transaction type',e=>e.transaction.type='0x2','TRANSACTION_FEES'],
 ['failed receipt',e=>e.receipt.status='0x0','RECEIPT_SUCCESS'],
 ['receipt for another transaction',e=>e.receipt.transactionHash=hash('d'),'RECEIPT_TRANSACTION'],
 ['wrong derived contract',e=>e.receipt.contractAddress='0x1111111111111111111111111111111111111111','RECEIPT_CONTRACT'],
 ['gas usage over approved limit',e=>e.receipt.gasUsed=q(5000001),'RECEIPT_FEE_BUDGET'],
 ['different effective price',e=>e.receipt.effectiveGasPrice='0x12','RECEIPT_FEE_BUDGET'],
 ['receipt block mismatch',e=>e.receipt.blockHash=hash('d'),'CANONICAL_RECEIPT_BLOCK'],
 ['transaction block mismatch',e=>e.transaction.blockNumber=q(99),'TRANSACTION_BLOCK'],
 ['transaction omitted from canonical block',e=>e.canonicalBlock.transactions=[hash('d')],'CANONICAL_TRANSACTION_INCLUSION'],
 ['changed canonical block after calls',e=>e.finalBlockReread.hash=hash('d'),'CANONICAL_BLOCK_REREAD'],
 ['only eleven confirmations',e=>e.headBlock.number=q(110),'FINALITY_DEPTH'],
 ['head behind deployment',e=>e.headBlock.number=q(99),'FINALITY_DEPTH'],
 ['runtime from another block',e=>e.runtimeCode.blockHash=hash('d'),'RUNTIME_BLOCK_BINDING'],
 ['unpatched runtime',e=>e.runtimeCode.code=artifact.deployedBytecode,'DEPLOYED_RUNTIME_POLICY_BINDING'],
 ['500T immutable policy',e=>e.runtimeCode.code=patchedRuntime('0x95f806c9c64fd2cee955eb0c05ffcb6653f4cdeab33a85b993e1bd4c60f3092c'),'DEPLOYED_RUNTIME_POLICY_BINDING'],
 ['missing mint event',e=>e.receipt.logs=[],'CONSTRUCTOR_MINT_EVENT_COUNT'],
 ['duplicate mint event',e=>e.receipt.logs.push(structuredClone(e.receipt.logs[0])),'CONSTRUCTOR_MINT_EVENT_COUNT'],
 ['wrong mint amount',e=>e.receipt.logs[0].data=iface.encodeFunctionResult('totalSupply',[500000000000000000000n]),'CONSTRUCTOR_MINT_EVENT'],
 ['mint recipient mismatch',e=>e.receipt.logs[0].topics[2]='0x'+'1'.repeat(64),'CONSTRUCTOR_MINT_EVENT'],
 ['removed mint log',e=>e.receipt.logs[0].removed=true,'MINT_EVENT_BLOCK_BINDING'],
 ['mint log block mismatch',e=>e.receipt.logs[0].blockHash=hash('d'),'MINT_EVENT_BLOCK_BINDING']
])test('rejects '+name,async()=>{await rejects(change,error);});

for(let index=0;index<RECEIPT_CALLS.length;index++)test('checks exact '+RECEIPT_CALLS[index].name+' result and receipt-block binding',async()=>{
 await rejects(e=>e.calls[index].result='0x'+'f'.repeat(64),'GETTER_'+RECEIPT_CALLS[index].name);
 await rejects(e=>e.calls[index].blockHash=hash('d'),'CALL_BINDING_'+RECEIPT_CALLS[index].name);
 await rejects(e=>e.calls[index].to='0x1111111111111111111111111111111111111111','CALL_BINDING_'+RECEIPT_CALLS[index].name);
});

test('duplicate getter evidence cannot replace a required observation',async()=>{
 await rejects(e=>e.calls[1]=structuredClone(e.calls[0]),'CALL_BINDING_name');
 await rejects(e=>e.calls.pop(),'MALFORMED_OR_INCOMPLETE_EVIDENCE');
});

test('exact zero-fee observations remain valid, while numeric coercions, overflows and malformed RPC values fail',async()=>{
 const zero=evidence();zero.candidate.gasPrice='0';zero.candidate.maximumFeeBaseUnits='0';zero.transaction.gasPrice='0x0';zero.receipt.effectiveGasPrice='0x0';assert.equal((await verifyOwnerDeploymentReceipt(zero)).valid,true);
 await rejects(e=>e.candidate.gasLimit=5000000,'MALFORMED_OR_INCOMPLETE_EVIDENCE');
 await rejects(e=>{e.candidate.gasLimit=((1n<<256n)-1n).toString();e.candidate.gasPrice='2';e.candidate.maximumFeeBaseUnits=((1n<<256n)-1n).toString();},'CANDIDATE_FEE_BUDGET');
 for(const invalid of ['0x00','0x-1','0x'+'1'.repeat(65),42,null])await rejects(e=>e.transaction.nonce=invalid,'MALFORMED_OR_INCOMPLETE_EVIDENCE');
 assert.equal((await verifyOwnerDeploymentReceipt()).valid,false);assert.equal((await verifyOwnerDeploymentReceipt(null)).valid,false);
});

test('caller mutation during async hashing cannot change captured evidence',async()=>{
 const data=evidence(),pending=verifyOwnerDeploymentReceipt(data);data.candidate.data='0x00';data.receipt.contractAddress='0x1111111111111111111111111111111111111111';data.calls.length=0;
 assert.equal((await pending).valid,true);
});
