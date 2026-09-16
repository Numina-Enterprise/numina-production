import {SIGNING_PINS} from './wallet-signing-model.js';

// Generated from the raw reviewed artifact a77132...262a: deployedBytecode is
// 8,036 bytes; its sole issuerPolicyHash immutable is 32 bytes at offset 1,086.
// The hash below includes the revised 1,500T policy, not the retained 500T policy.
export const EXPECTED_RUNTIME_SHA256='e6a1e2f07c0bfa9f2a55f704924a110bb6c516e003b6aeefc7ebb393ffc0eb15';
export const EXPECTED_RUNTIME_BYTES=8036;
export const MINIMUM_CONFIRMATIONS=12;
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const word=value=>BigInt(value).toString(16).padStart(64,'0');
const addressWord=value=>value.slice(2).toLowerCase().padStart(64,'0');
const stringResult=value=>'0x'+word(32)+word(value.length)+Array.from(new TextEncoder().encode(value),byte=>byte.toString(16).padStart(2,'0')).join('').padEnd(64,'0');
const roleCall=(label,role,address)=>({name:'hasRole.'+label,data:'0x91d14854'+role+addressWord(address),expectedResult:'0x'+word(1)});
export const RECEIPT_CALLS=freeze([
 {name:'name',data:'0x06fdde03',expectedResult:stringResult('Numina USD')},
 {name:'symbol',data:'0x95d89b41',expectedResult:stringResult('NUSD')},
 {name:'decimals',data:'0x313ce567',expectedResult:'0x'+word(6)},
 {name:'paused',data:'0x5c975abb',expectedResult:'0x'+word(1)},
 {name:'totalSupply',data:'0x18160ddd',expectedResult:'0x'+word(SIGNING_PINS.initialSupplyBaseUnits)},
 {name:'balanceOf',data:'0x70a08231'+addressWord(SIGNING_PINS.sender),expectedResult:'0x'+word(SIGNING_PINS.initialSupplyBaseUnits)},
 {name:'authorizedSupply',data:'0x189aff3a',expectedResult:'0x'+word(0)},
 {name:'issuerPolicyHash',data:'0x6bcbfc3c',expectedResult:'0x'+SIGNING_PINS.policy},
 {name:'defaultAdmin',data:'0x84ef8ffc',expectedResult:'0x'+addressWord('0xa7e9FB02495700ccE0d209392C0A30FbE077498e')},
 {name:'defaultAdminDelay',data:'0xcc8463c8',expectedResult:'0x'+word(86400)},
 roleCall('admin','0'.repeat(64),'0xa7e9FB02495700ccE0d209392C0A30FbE077498e'),
 roleCall('issuer','114e74f6ea3bd819998f78687bfcb11b140da08e9b7d222fa9c1f1ba1f2aa122','0xdfEb99a8CbB9d2536EB9CA3D4D38DC5f4D1dE1a0'),
 roleCall('minter','9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6','0x62dC06f05aF1b9aBA65d7ee4DBaB067249FC5DA6'),
 roleCall('pauser','65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a','0x434AB24E613055Fd2598Fd9f0558A06a94D39c81')
]);

const HASH=/^0x[0-9a-fA-F]{64}$/,ADDRESS=/^0x[0-9a-fA-F]{40}$/,MAX=(1n<<256n)-1n;
const hash=value=>typeof value==='string'&&HASH.test(value)&&!/^0x0{64}$/i.test(value);
const address=value=>typeof value==='string'&&ADDRESS.test(value)&&!/^0x0{40}$/i.test(value);
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const bytes=value=>{if(typeof value!=='string'||!/^0x(?:[0-9a-fA-F]{2})*$/.test(value))throw Error('Invalid hex bytes');return Uint8Array.from(value.slice(2).match(/../g)??[],pair=>parseInt(pair,16));};
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value)),byte=>byte.toString(16).padStart(2,'0')).join('');
function integer(value){if(typeof value!=='string'||!/^(0|[1-9][0-9]{0,77})$/.test(value)||BigInt(value)>MAX)throw Error('Invalid decimal quantity');return BigInt(value);}
function quantity(value){if(typeof value!=='string'||!/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/.test(value))throw Error('Invalid RPC quantity');return BigInt(value);}

// Keccak-f[1600], used only to derive CREATE(sender, nonce). No key or signing
// operation exists here. The byte/word implementation is cross-checked offline
// against the reviewed ethers dependency for nonce boundary cases.
const MASK=(1n<<64n)-1n;
const ROT=[0,1,62,28,27,36,44,6,55,20,3,10,43,25,39,41,45,15,21,8,18,2,61,56,14];
const RC=[0x1n,0x8082n,0x800000000000808an,0x8000000080008000n,0x808bn,0x80000001n,0x8000000080008081n,0x8000000000008009n,0x8an,0x88n,0x80008009n,0x8000000an,0x8000808bn,0x800000000000008bn,0x8000000000008089n,0x8000000000008003n,0x8000000000008002n,0x8000000000000080n,0x800an,0x800000008000000an,0x8000000080008081n,0x8000000000008080n,0x80000001n,0x8000000080008008n];
const rotate=(value,n)=>n?((value<<BigInt(n))|(value>>BigInt(64-n)))&MASK:value;
function keccak256(input){
 const state=Array(25).fill(0n),rate=136,padded=new Uint8Array(Math.ceil((input.length+1)/rate)*rate);padded.set(input);padded[input.length]=1;padded[padded.length-1]|=128;
 for(let offset=0;offset<padded.length;offset+=rate){
  for(let i=0;i<rate;i++)state[Math.floor(i/8)]^=BigInt(padded[offset+i])<<BigInt((i%8)*8);
  for(const rc of RC){
   const c=Array.from({length:5},(_,x)=>state[x]^state[x+5]^state[x+10]^state[x+15]^state[x+20]);
   for(let x=0;x<5;x++){const d=c[(x+4)%5]^rotate(c[(x+1)%5],1);for(let y=0;y<5;y++)state[x+5*y]^=d;}
   const b=Array(25).fill(0n);for(let x=0;x<5;x++)for(let y=0;y<5;y++)b[y+5*((2*x+3*y)%5)]=rotate(state[x+5*y],ROT[x+5*y]);
   for(let x=0;x<5;x++)for(let y=0;y<5;y++)state[x+5*y]=b[x+5*y]^((~b[(x+1)%5+5*y])&b[(x+2)%5+5*y]);
   state[0]^=rc;
  }
 }
 return Uint8Array.from({length:32},(_,i)=>Number((state[Math.floor(i/8)]>>BigInt((i%8)*8))&255n));
}
export function expectedDeploymentAddress(sender,nonce){
 if(!address(sender))throw Error('Invalid sender');const n=integer(nonce),encodedNonce=n===0n?Uint8Array.of(128):n<128n?Uint8Array.of(Number(n)):(()=>{let hex=n.toString(16);if(hex.length%2)hex='0'+hex;const raw=bytes('0x'+hex);return Uint8Array.of(128+raw.length,...raw);})();
 const payload=Uint8Array.of(148,...bytes(sender),...encodedNonce),rlp=Uint8Array.of(192+payload.length,...payload);
 return '0x'+Array.from(keccak256(rlp).slice(12),byte=>byte.toString(16).padStart(2,'0')).join('');
}

// All evidence is supplied by the caller. Consistency is not independent chain,
// custody, reserve or settlement verification. No RPC, wallet or journal writes.
export async function verifyOwnerDeploymentReceipt(input={}){
 const errors=[],check=(condition,label)=>{if(!condition)errors.push(label);};let deployment=null;
 try{
  // Snapshot before the first digest await; caller edits cannot replace evidence.
  const text=JSON.stringify(input);if(typeof text!=='string'||text.length>2*1024*1024)throw Error('Evidence too large');
  const {candidate:c,transaction:tx,receipt:r,canonicalBlock:block,headBlock:head,finalBlockReread:last,runtimeCode:runtime,calls}=JSON.parse(text);
  if(!c||!tx||!r||!block||!head||!last||!runtime||!Array.isArray(calls)||calls.length!==RECEIPT_CALLS.length)throw Error('Incomplete evidence');
  const nonce=integer(c.nonce),gas=integer(c.gasLimit),price=integer(c.gasPrice),budget=integer(c.maximumFeeBaseUnits);
  check(c.chainId===SIGNING_PINS.chainId&&same(c.genesisHash,SIGNING_PINS.genesisHash)&&same(c.from,SIGNING_PINS.sender),'CANDIDATE_IDENTITY');
  check(hash(c.submittedHash),'SUBMITTED_HASH');check(c.to===null&&c.value==='0'&&gas>0n,'CANDIDATE_DEPLOYMENT');
  check(gas*price<=MAX&&gas*price<=budget,'CANDIDATE_FEE_BUDGET');
  check(typeof c.data==='string'&&c.data.length===21494&&await digest(bytes(c.data))===SIGNING_PINS.creation,'CANDIDATE_CREATION_HASH');
  const contract=expectedDeploymentAddress(SIGNING_PINS.sender,c.nonce);
  check(hash(tx.hash)&&same(tx.hash,c.submittedHash),'TRANSACTION_HASH');
  check(same(tx.from,SIGNING_PINS.sender)&&quantity(tx.chainId).toString()===SIGNING_PINS.chainId&&quantity(tx.nonce)===nonce,'TRANSACTION_IDENTITY');
  check(tx.to===null&&quantity(tx.value)===0n&&same(tx.input,c.data),'TRANSACTION_CREATION');
  check(quantity(tx.type)===0n&&quantity(tx.gas)===gas&&quantity(tx.gasPrice)===price,'TRANSACTION_FEES');
  check(r.status==='0x1'&&quantity(r.type)===0n,'RECEIPT_SUCCESS');
  check(hash(r.transactionHash)&&same(r.transactionHash,c.submittedHash),'RECEIPT_TRANSACTION');
  check(address(r.contractAddress)&&same(r.contractAddress,contract)&&same(r.from,SIGNING_PINS.sender)&&r.to===null,'RECEIPT_CONTRACT');
  const used=quantity(r.gasUsed),effective=quantity(r.effectiveGasPrice);
  check(used>0n&&used<=gas&&effective===price&&used*effective<=budget&&quantity(r.cumulativeGasUsed)>=used,'RECEIPT_FEE_BUDGET');
  const blockNumber=quantity(block.number),headNumber=quantity(head.number),index=quantity(r.transactionIndex);
  check(hash(block.hash)&&hash(head.hash)&&hash(r.blockHash)&&same(r.blockHash,block.hash)&&quantity(r.blockNumber)===blockNumber,'CANONICAL_RECEIPT_BLOCK');
  check(hash(tx.blockHash)&&same(tx.blockHash,block.hash)&&quantity(tx.blockNumber)===blockNumber&&quantity(tx.transactionIndex)===index,'TRANSACTION_BLOCK');
  check(Array.isArray(block.transactions)&&index<BigInt(block.transactions.length)&&same(block.transactions[Number(index)],c.submittedHash),'CANONICAL_TRANSACTION_INCLUSION');
  check(hash(last.hash)&&same(last.hash,block.hash)&&quantity(last.number)===blockNumber,'CANONICAL_BLOCK_REREAD');
  const confirmations=headNumber-blockNumber+1n;check(confirmations>=BigInt(MINIMUM_CONFIRMATIONS),'FINALITY_DEPTH');
  check(same(runtime.address,contract)&&same(runtime.blockHash,block.hash),'RUNTIME_BLOCK_BINDING');
  check(typeof runtime.code==='string'&&runtime.code.length===2+EXPECTED_RUNTIME_BYTES*2&&await digest(bytes(runtime.code))===EXPECTED_RUNTIME_SHA256,'DEPLOYED_RUNTIME_POLICY_BINDING');
  for(const expected of RECEIPT_CALLS){
   const matches=calls.filter(call=>call&&same(call.to,contract)&&same(call.blockHash,block.hash)&&same(call.data,expected.data));
   check(matches.length===1,'CALL_BINDING_'+expected.name);
   if(matches.length===1)check(same(matches[0].result,expected.expectedResult),'GETTER_'+expected.name);
  }
  if(!Array.isArray(r.logs)||r.logs.length>256)throw Error('Invalid receipt logs');
  const transfers=r.logs.filter(log=>log&&same(log.address,contract)&&Array.isArray(log.topics)&&same(log.topics[0],'0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'));
  check(transfers.length===1,'CONSTRUCTOR_MINT_EVENT_COUNT');
  if(transfers.length===1){
   const log=transfers[0];
   check(log.topics.length===3&&same(log.topics[1],'0x'+word(0))&&same(log.topics[2],'0x'+addressWord(SIGNING_PINS.sender))&&same(log.data,'0x'+word(SIGNING_PINS.initialSupplyBaseUnits)),'CONSTRUCTOR_MINT_EVENT');
   check(log.removed===false&&same(log.transactionHash,c.submittedHash)&&same(log.blockHash,block.hash)&&quantity(log.blockNumber)===blockNumber&&quantity(log.transactionIndex)===index&&quantity(log.logIndex)>=0n,'MINT_EVENT_BLOCK_BINDING');
  }
  deployment={address:contract,transactionHash:c.submittedHash.toLowerCase(),blockNumber:blockNumber.toString(),blockHash:block.hash.toLowerCase(),confirmations:confirmations.toString(),supplyBaseUnits:SIGNING_PINS.initialSupplyBaseUnits,recipient:SIGNING_PINS.sender,decimals:6,paused:true,authorizedSupply:'0',supplyPolicy:'uncapped_uint256',issuerPolicyHash:'0x'+SIGNING_PINS.policy,runtimeSha256:EXPECTED_RUNTIME_SHA256,gasUsed:used.toString(),effectiveGasPrice:effective.toString(),observedFeeBaseUnits:(used*effective).toString()};
 }catch{errors.push('MALFORMED_OR_INCOMPLETE_EVIDENCE');}
 const valid=errors.length===0;
 return freeze({schema:'numina.nusd.owner-deployment-receipt-review.v1',status:valid?'CONSISTENT_PROVIDER_OBSERVATION':'EVIDENCE_INCOMPLETE_OR_INCONSISTENT',valid,verification:'provider_observation',errors:[...new Set(errors)],candidateDeployment:valid?deployment:null,scope:'supplied_evidence_consistency_only',independentNetworkVerification:false,signingControlVerified:false,fundsVerified:false,reservesVerified:false,settlementVerified:false,productionMetadataUpdated:false,nativeJournalWritten:false,depositPerformed:false});
}
