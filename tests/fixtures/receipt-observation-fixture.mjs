// Synthetic test observations only; never production evidence.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Interface,getCreateAddress,id,ZeroHash,ZeroAddress} from '../../public/vendor/ethers-6.15.0.min.js';
import {SIGNING_PINS} from '../../public/wallet-signing-model.js';
import {EXPECTED_RUNTIME_SHA256,EXPECTED_RUNTIME_BYTES,MINIMUM_CONFIRMATIONS,RECEIPT_CALLS,expectedDeploymentAddress,verifyOwnerDeploymentReceipt} from '../../public/wallet-execution-receipt.js';

const artifactBytes=readFileSync(new URL('../../runtime/nusd/reviews/uncapped-500t/artifacts/NuminaUSD.json',import.meta.url));
const artifact=JSON.parse(artifactBytes),reviewBytes=readFileSync(new URL('../../public/wallet-signing-review.json',import.meta.url)),review=JSON.parse(reviewBytes),iface=new Interface(artifact.abi);
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
export function evidence(){
 const candidate={submittedHash:hash('a'),chainId:SIGNING_PINS.chainId,genesisHash:SIGNING_PINS.genesisHash,from:SIGNING_PINS.sender,nonce:'128',gasLimit:'5000000',gasPrice:'17',maximumFeeBaseUnits:'85000000',value:'0',to:null,data:review.constructorData};
 const contract=getCreateAddress({from:candidate.from,nonce:BigInt(candidate.nonce)}),blockHash=hash('b');
 const transaction={hash:candidate.submittedHash,from:candidate.from,chainId:q(candidate.chainId),nonce:q(candidate.nonce),to:null,value:'0x0',input:candidate.data,type:'0x0',gas:q(candidate.gasLimit),gasPrice:q(candidate.gasPrice),blockHash,blockNumber:q(100),transactionIndex:'0x0'};
 const log={...iface.encodeEventLog(iface.getEvent('Transfer'),[ZeroAddress,candidate.from,BigInt(SIGNING_PINS.initialSupplyBaseUnits)]),address:contract,removed:false,transactionHash:candidate.submittedHash,blockHash,blockNumber:q(100),transactionIndex:'0x0',logIndex:'0x2'};
 const receipt={status:'0x1',type:'0x0',transactionHash:candidate.submittedHash,contractAddress:contract,from:candidate.from,to:null,gasUsed:q(4000000),effectiveGasPrice:q(17),cumulativeGasUsed:q(4200000),blockHash,blockNumber:q(100),transactionIndex:'0x0',logs:[log]};
 const canonicalBlock={hash:blockHash,number:q(100),transactions:[candidate.submittedHash]};
 return {candidate,transaction,receipt,canonicalBlock,headBlock:{hash:hash('c'),number:q(111)},finalBlockReread:{hash:blockHash,number:q(100)},runtimeCode:{address:contract,blockHash,code:patchedRuntime()},calls:getterCalls().map(call=>({...call,to:contract,blockHash}))};
}
