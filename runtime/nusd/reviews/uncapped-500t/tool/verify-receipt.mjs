import {readFileSync,writeFileSync} from 'node:fs';import {resolve} from 'node:path';import {fileURLToPath} from 'node:url';
import {Interface,Transaction,getCreateAddress,id,ZeroHash,ZeroAddress} from 'ethers';
import {PINS,ARGUMENTS,sha256,publicAddress,exactInteger} from './prepare.mjs';

export function expectedRuntime(artifact,policyHash){
 const entries=artifact.runtimeImmutables;if(!Array.isArray(entries)||entries.length!==1||entries[0].variableName!=='issuerPolicyHash'||!/^0x[0-9a-fA-F]{64}$/.test(policyHash))throw Error('Unexpected immutable layout');
 const output=Buffer.from(artifact.deployedBytecode.slice(2),'hex');
 for(const ref of entries[0].references){if(ref.length!==32||!Number.isSafeInteger(ref.start)||ref.start<0||ref.start+32>output.length)throw Error('Invalid immutable offset');Buffer.from(policyHash.slice(2),'hex').copy(output,ref.start);}
 return '0x'+output.toString('hex');
}
export function verifyDeploymentEvidence({draft,artifactBytes,policyBytes,expected,evidence}){
 const errors=[],check=(condition,label)=>{if(!condition)errors.push(label);};let candidate=null;
 try{
  check(sha256(artifactBytes)===PINS.artifact,'ARTIFACT_HASH');const artifact=JSON.parse(artifactBytes),iface=new Interface(artifact.abi);
  check(sha256(policyBytes)===PINS.policy,'POLICY_HASH');const policy=JSON.parse(policyBytes);
  check(draft.schema==='numina.nusd.unsigned-constructor-review.v1'&&draft.status==='UNSIGNED_CONSTRUCTOR_REVIEW','DRAFT_STATUS');
  check(draft.artifactSha256===PINS.artifact&&draft.sourceSha256===PINS.source&&draft.issuerPolicySha256===PINS.policy,'DRAFT_PINS');
  for(const role of ['admin','issuer','minter','pauser'])check(publicAddress(draft.constructor[role]).toLowerCase()===publicAddress(policy.roles[role]).toLowerCase(),'POLICY_ROLE_'+role);
  publicAddress(draft.constructor.initialRecipient);
  check(draft.constructor.adminDelaySeconds===policy.adminDelaySeconds,'POLICY_ADMIN_DELAY');
  check(draft.constructor.initialSupplyBaseUnits==='500000000000000000000'&&draft.constructor.approvedIssuerPolicyHash==='0x'+PINS.policy,'SUPPLY_POLICY');
  const creation=artifact.bytecode+iface.encodeDeploy(ARGUMENTS.map(name=>draft.constructor[name])).slice(2);check(creation===draft.constructorData,'CONSTRUCTOR_DATA');
  const chain=exactInteger(expected.chainId),nonce=exactInteger(expected.nonce),confirmations=exactInteger(expected.minimumConfirmations);
  check(confirmations>=12n,'CONFIRMATION_POLICY');const sender=publicAddress(expected.sender);
  check(typeof expected.genesisHash==='string'&&/^0x[0-9a-fA-F]{64}$/.test(expected.genesisHash),'GENESIS_PIN_REQUIRED');
  check(evidence.network.chainId===expected.chainId&&evidence.network.genesisHash?.toLowerCase()===expected.genesisHash?.toLowerCase(),'NETWORK_IDENTITY');
  const tx=Transaction.from(evidence.rawTransaction);check(tx.isSigned(),'SIGNED_TRANSACTION_REQUIRED');check(tx.chainId===chain&&tx.from?.toLowerCase()===sender.toLowerCase()&&BigInt(tx.nonce)===nonce,'TRANSACTION_IDENTITY');
  const feeCeiling=tx.maxFeePerGas??tx.gasPrice;check(feeCeiling!==null&&tx.gasLimit*feeCeiling<=exactInteger(expected.maximumTotalFeeBaseUnits),'APPROVED_FEE_BUDGET');
  check(tx.to===null&&tx.value===0n&&tx.data.toLowerCase()===creation.toLowerCase(),'DEPLOYMENT_TRANSACTION');
  const receipt=evidence.receipt,address=getCreateAddress({from:sender,nonce}),block=evidence.canonicalBlock,head=evidence.headBlock;
  check(receipt.status==='0x1','RECEIPT_SUCCESS');check(receipt.transactionHash?.toLowerCase()===tx.hash?.toLowerCase(),'RECEIPT_TRANSACTION');
  check(receipt.contractAddress?.toLowerCase()===address.toLowerCase()&&receipt.from?.toLowerCase()===sender.toLowerCase()&&receipt.to===null,'RECEIPT_CONTRACT');
  const quantity=value=>{if(typeof value!=='string'||!/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value))throw Error('Invalid block quantity');return BigInt(value);};
  const validHash=value=>typeof value==='string'&&/^0x[0-9a-fA-F]{64}$/.test(value);
  check(validHash(receipt.blockHash)&&validHash(block.hash)&&validHash(head.hash),'BLOCK_HASH_FORMAT');
  check(receipt.blockHash?.toLowerCase()===block.hash?.toLowerCase()&&quantity(receipt.blockNumber)===quantity(block.number),'CANONICAL_RECEIPT_BLOCK');
  check(evidence.finalBlockReread?.hash?.toLowerCase()===block.hash?.toLowerCase()&&evidence.finalBlockReread?.number===block.number,'CANONICAL_BLOCK_REREAD');
  check(quantity(head.number)-quantity(block.number)+1n>=confirmations,'FINALITY_DEPTH');
  const runtime=evidence.runtime;check(runtime.address?.toLowerCase()===address.toLowerCase()&&runtime.blockHash?.toLowerCase()===block.hash?.toLowerCase(),'RUNTIME_BLOCK_BINDING');
  check(runtime.code?.toLowerCase()===expectedRuntime(artifact,draft.constructor.approvedIssuerPolicyHash).toLowerCase(),'DEPLOYED_RUNTIME');
  function call(name,args,wanted){
   const data=iface.encodeFunctionData(name,args),matches=evidence.calls.filter(value=>value.to?.toLowerCase()===address.toLowerCase()&&value.data?.toLowerCase()===data.toLowerCase()&&value.blockHash?.toLowerCase()===block.hash.toLowerCase());
   if(matches.length!==1){errors.push('CALL_BINDING_'+name);return;}let result;try{result=iface.decodeFunctionResult(name,matches[0].result)[0];}catch{errors.push('CALL_RESULT_'+name);return;}
   check(typeof wanted==='string'?String(result).toLowerCase()===wanted.toLowerCase():result===wanted,'GETTER_'+name);
  }
  call('name',[],'Numina USD');call('symbol',[],'NUSD');call('decimals',[],6n);call('paused',[],true);call('totalSupply',[],500000000000000000000n);call('balanceOf',[draft.constructor.initialRecipient],500000000000000000000n);call('authorizedSupply',[],0n);call('issuerPolicyHash',[],draft.constructor.approvedIssuerPolicyHash);call('defaultAdmin',[],draft.constructor.admin);call('defaultAdminDelay',[],BigInt(draft.constructor.adminDelaySeconds));
  for(const [role,addressValue] of [[ZeroHash,draft.constructor.admin],[id('ISSUER_ROLE'),draft.constructor.issuer],[id('MINTER_ROLE'),draft.constructor.minter],[id('PAUSER_ROLE'),draft.constructor.pauser]])call('hasRole',[role,addressValue],true);
  const tokenLogs=receipt.logs.filter(log=>log.address?.toLowerCase()===address.toLowerCase());
  const mintLogs=tokenLogs.map(log=>{try{return iface.parseLog(log);}catch{return null;}}).filter(log=>log?.name==='Transfer'&&log.args[0]===ZeroAddress);
  check(mintLogs.length===1&&mintLogs[0].args[1].toLowerCase()===draft.constructor.initialRecipient.toLowerCase()&&mintLogs[0].args[2]===500000000000000000000n,'CONSTRUCTOR_MINT_EVENT');
  candidate={address,transactionHash:tx.hash,blockNumber:quantity(block.number).toString(),blockHash:block.hash,supplyBaseUnits:'500000000000000000000',decimals:6,paused:true,supplyPolicy:'uncapped_uint256'};
 }catch{errors.push('MALFORMED_OR_INCOMPLETE_EVIDENCE');}
 return {schema:'numina.nusd.receipt-consistency-review.v1',valid:errors.length===0,errors:[...new Set(errors)],candidateDeployment:errors.length?null:candidate,scope:'supplied_evidence_consistency_only',independentProviderVerification:false,productionMetadataUpdated:false,nativeJournalWritten:false,depositPerformed:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(Number(process.versions.node.split('.')[0])!==24)throw Error('Node 24 is required');const args=process.argv.slice(2),output=args[args.indexOf('--output')+1];if(!args.includes('--output')||!output)throw Error('Usage: node tool/verify-receipt.mjs PACKAGE_ROOT DRAFT.json EXPECTED.json EVIDENCE.json --output OUTPUT.json');
 const report=verifyDeploymentEvidence({artifactBytes:readFileSync(resolve(args[0],'artifacts/NuminaUSD.json')),policyBytes:readFileSync(resolve(args[0],'requests/issuance-preparation-policy.json')),draft:JSON.parse(readFileSync(args[1])),expected:JSON.parse(readFileSync(args[2])),evidence:JSON.parse(readFileSync(args[3]))});writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(!report.valid)process.exitCode=2;
}
