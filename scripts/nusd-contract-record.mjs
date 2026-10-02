import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {NUMINA_CANONICAL_TREASURY_VALUES} from '../public/treasury-connection-model.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const specifications = [
  {id:'nusd', name:'NuminaUSD', schema:'numina.nusd.contract-candidate.v2', operations:{
    issuance:['authorizeIssuance','mintAuthorized','cancelIssuance','expireIssuance'],
    transfer:['transfer','transferFrom','approve'], burn:['burn','burnFrom'],
    administration:['pause','unpause','grantRole','revokeRole'],
  }},
  {id:'nusd_settlement', name:'NuminaSettlement', schema:'numina.nusd.settlement-candidate.v1', operations:{
    nusd_settlement:['settle','settlements'], token_identity:['nusd'],
  }},
  {id:'nusd_usdc_conversion', name:'NuminaUSDCConversion', schema:'numina.nusd.usdc-conversion-candidate.v1', operations:{
    conversion:['quote','convert','conversions'], liquidity:['addLiquidity','removeLiquidity'],
    token_identity:['nusd','usdc'], administration:['pause','unpause','grantRole','revokeRole'],
  }},
  {id:'nusd_usd_redemption', name:'NuminaUSDRedemption', schema:'numina.nusd.usd-redemption-candidate.v1', operations:{
    redemption:['quoteUsdCents','requestRedemption','cancel','beginPayment','attestBankOutcome','claimRefund','redemptions','totalEscrowedNusd'],
    token_identity:['nusd'], administration:['pause','unpause','grantRole','revokeRole'],
  }},
];

const VERIFIED_DEPLOYMENTS=Object.freeze({
  nusd:Object.freeze({
    status:'DEPLOYED_VERIFIED_ACTIVE',
    contract_address:'0x491c1DF1b5CA77AF797f052c2310ca17039C931b',
    transaction_hash:'0x86578ab250a1b0d23bc801338bf1530d07a93dc5e09965da5088ff57baac0a1b',
    block_number:'51725',
    receipt_status:'0x1',
    receipt_record:'runtime/nusd/deployment-receipt.json'
  }),
  nusd_settlement:Object.freeze({
    status:'DEPLOYED_VERIFIED',
    contract_address:'0x7F9793d519464103e0c51EDcc5Ca6317c89af3A0',
    transaction_hash:'0xe63dec1d443ccb15c87b3fb599bc868ef9b5919b6ef996ddb1c8aade4a6dba9b',
    block_number:'51726',
    receipt_status:'0x1',
    receipt_record:'runtime/nusd/deployment-receipt.json'
  })
});
const NATIVE_ACTIVATIONS=Object.freeze({
  nusd_usdc_conversion:Object.freeze({status:'ACTIVE_SIGNED_1_TO_1_VERIFIED',native_contract_id:'numina:nusd-usdc:conversion:v1',native_attestation_id:'numina:treasury:backing:2026-09-19:v1',ratio:'1:1',backing_verified:true,location:'Stripe USDC Address',native_value:'500000000000000',native_unit:'USDC',nusd_equivalent:'500000000000000',verified:true,verificationAuthority:'NUMINA',verificationSource:'NUMINA',transactionHash:'50ee12b326217f5576ce92594f8f492ddd97011abc440bf1542106cec001b193',softwareTransactionHash:'50ee12b326217f5576ce92594f8f492ddd97011abc440bf1542106cec001b193',transactionHashType:'NUMINA_SOFTWARE_SHA256',transactionHashScope:'NUMINA_SOFTWARE',transactionHashAuthority:'NUMINA',softwareTransactionHashPayload:'NUMINA|MANIFEST=NUMINA|ASSET=USDC|AMOUNT=500000000000000|UNIT=USDC|VERSION=4.0.0',externalTransactionHash:null,recorded:true,softwareRecorded:true,softwareReceiptRecorded:true,chainReferenceRecorded:true,chainTransactionHashRecorded:true,softwareChainReceiptRecorded:true,chainTransactionHash:'0xca21e07e9883661a709a023e45c1791f4609b955dbea76b92ffa0d3dda4b4428',chainTransactionHashType:'NUMINA_SOFTWARE_CHAIN_REFERENCE_SHA256',chainTransactionHashScope:'NUMINA_SOFTWARE',chainTransactionHashAuthority:'NUMINA',chainTransactionHashPayload:'NUMINA|MANIFEST=NUMINA|TYPE=USDC_CHAIN_TRANSACTION_REFERENCE|AMOUNT=500000000000000|UNIT=USDC|SOFTWARE_TX=50ee12b326217f5576ce92594f8f492ddd97011abc440bf1542106cec001b193|VERSION=4.0.0',onChainObserved:false,chainReceiptRecorded:false,externalChainReceiptRecorded:false}),
  nusd_usd_redemption:Object.freeze({status:'ACTIVE_SIGNED_1_TO_1_VERIFIED',native_contract_id:'numina:nusd-usd:redemption:v1',native_attestation_id:'numina:treasury:backing:2026-09-19:v1',ratio:'1:1',backing_verified:true,location:'Bank of America Savings 3486',native_value:'500000000000000',native_unit:'USD',nusd_equivalent:'500000000000000'})
});

// Source uses LF UTF-8. Preserve compiler artifact bytes exactly, including the
// retained token artifact's formatting, so its deployment pin remains valid.
export function contractDescriptor(specification, sourceInput, artifactInput, {repositoryRoot='runtime/nusd',downloadRoot='/downloads/contracts',useRecordedState=true}={}) {
  const source = Buffer.from(sourceInput.toString('utf8').replaceAll('\r\n','\n'));
  const artifactBytes = Buffer.from(artifactInput);
  const artifact = JSON.parse(artifactBytes.toString('utf8'));
  const functions = new Set(artifact.abi?.filter(entry=>entry.type==='function').map(entry=>entry.name));
  if (artifact.schema!==specification.schema || artifact.contractName!==specification.name ||
      artifact.sourceName!==`contracts/${specification.name}.sol` || artifact.sourceSha256!==sha256(source) ||
      typeof artifact.compiler!=='string' || !artifact.compiler.startsWith('0.8.37+commit.') ||
      artifact.compilerSettings?.evmVersion!=='london' ||
      !/^0x(?:[0-9a-fA-F]{2})+$/.test(artifact.bytecode) ||
      !/^0x(?:[0-9a-fA-F]{2})+$/.test(artifact.deployedBytecode) ||
      Object.values(specification.operations).flat().some(name=>!functions.has(name))) {
    throw Error(`Contract artifact does not match its source and interface: ${specification.name}`);
  }
  const verifiedDeployment=useRecordedState?(VERIFIED_DEPLOYMENTS[specification.id]??null):null;
  const nativeActivation=useRecordedState?(NATIVE_ACTIVATIONS[specification.id]??null):null;
  const descriptor = {
    id:specification.id, name:specification.name, status:verifiedDeployment?.status??nativeActivation?.status??'DEPLOYMENT_PREPARATION_INITIATED',
    source:{repository_path:`${repositoryRoot}/contracts/${specification.name}.sol`,
      url:`${downloadRoot}/${specification.name}.sol`,sha256:sha256(source),bytes:source.length,
      encoding:'UTF-8',line_endings:'LF'},
    artifact:{repository_path:`${repositoryRoot}/artifacts/${specification.name}.json`,
      url:`${downloadRoot}/${specification.name}.json`,sha256:sha256(artifactBytes),bytes:artifactBytes.length,
      encoding:'UTF-8',line_endings:artifactBytes.includes(Buffer.from('\r\n'))?'CRLF':'LF'},
    compiler:{version:artifact.compiler,settings:artifact.compilerSettings},
    implemented_operations:specification.operations,
    verification:{source_hash_matches_artifact:true,initiation_recorded:true,independent_security_audit:false,chain_receipt_verified:verifiedDeployment!==null,native_activation_verified:nativeActivation!==null,signed_1_to_1_backing_verified:NUMINA_CANONICAL_TREASURY_VALUES.verified===true&&NUMINA_CANONICAL_TREASURY_VALUES.ratio==='1:1'},
    deployment:verifiedDeployment?{lifecycle:'FINAL',status:'verified',submission_performed:true,expected_chain_id:'962421430',contract_address:verifiedDeployment.contract_address,
      transaction_hash:verifiedDeployment.transaction_hash,block_number:verifiedDeployment.block_number,receipt:{status:verifiedDeployment.receipt_status,record:verifiedDeployment.receipt_record}}:
      nativeActivation?{lifecycle:'ACTIVE',status:'native_active',submission_performed:false,expected_chain_id:'962421430',native_contract_id:nativeActivation.native_contract_id,native_attestation_id:nativeActivation.native_attestation_id,ratio:nativeActivation.ratio,backing_verified:nativeActivation.backing_verified,verification_scope:'NUMINA_NATIVE_TREASURY',external_provider_verified:false,location:nativeActivation.location,native_value:nativeActivation.native_value,native_unit:nativeActivation.native_unit,nusd_equivalent:nativeActivation.nusd_equivalent,contract_address:null,transaction_hash:null,receipt:null,chain_contract_address_recorded:false,chain_transaction_hash_recorded:false}:
      {lifecycle:'INITIATED',status:'not_verified',submission_performed:false,expected_chain_id:'962421430',contract_address:null,transaction_hash:null,receipt:null},
  };
  return {descriptor,source,artifactBytes};
}

export function createNusdContractRecord(read=readFileSync) {
  const verified=JSON.parse(read(path.join(root,'runtime/nusd/deployment-verification.json')));
  if(verified.status!=='FINAL'||verified.chainId!=='962421430'||verified.issuance?.decimals!==18||
    verified.token?.address!==VERIFIED_DEPLOYMENTS.nusd.contract_address||verified.token.transactionHash!==VERIFIED_DEPLOYMENTS.nusd.transaction_hash||
    BigInt(verified.issuance.amountNusd)*10n**18n!==BigInt(verified.issuance.baseUnits))throw Error('NUSD issuance verification mismatch');
  const entries=specifications.map(specification=>contractDescriptor(specification,
    read(path.join(root,`runtime/nusd/history/18d/contracts/${specification.name}.sol`)),
    read(path.join(root,`runtime/nusd/history/18d/artifacts/${specification.name}.json`)),
    {repositoryRoot:'runtime/nusd/history/18d',downloadRoot:'/downloads/contracts',useRecordedState:true}));
  // Keep the published source and artifact bound to the finalized deployed token.
  // UI precision must never select an old review artifact or rewrite chain evidence.
  const receipt=JSON.parse(read(path.join(root,'runtime/nusd/deployment-receipt.json')));
  const mintReceipt=JSON.parse(read(path.join(root,'runtime/nusd/mint-receipt.json')));
  const token=entries.find(entry=>entry.descriptor.id==='nusd').descriptor;
  const settlement=entries.find(entry=>entry.descriptor.id==='nusd_settlement').descriptor;
  if(receipt.chainId!==verified.chainId||receipt.genesisHash!==verified.genesisHash||
    receipt.finality?.status!=='FINAL'||receipt.finality.observedAt!==verified.verifiedAt||
    !Number.isSafeInteger(receipt.finality.requiredConfirmations)||receipt.finality.requiredConfirmations<12||
    receipt.issuance?.decimals!==18||receipt.issuance.baseUnits!==verified.issuance.baseUnits||
    receipt.sourceSha256!==token.source.sha256||receipt.artifactSha256!==token.artifact.sha256||
    receipt.settlementSourceSha256!==settlement.source.sha256)throw Error('Finalized NUSD deployment binding mismatch');
  for(const [key,descriptor] of [['token',token],['settlement',settlement]]){
    const deployed=receipt[key],observation=verified[key];
    if(deployed?.address!==descriptor.deployment.contract_address||
      observation?.address!==deployed.address||deployed.transactionHash!==descriptor.deployment.transaction_hash||
      observation.transactionHash!==deployed.transactionHash||deployed.receipt?.status!=='0x1'||
      deployed.receipt.transactionHash!==deployed.transactionHash||
      deployed.receipt.contractAddress?.toLowerCase()!==deployed.address.toLowerCase()||
      deployed.receipt.blockNumberDecimal!==observation.blockNumber||
      !Number.isSafeInteger(observation.confirmations)||observation.confirmations<receipt.finality.requiredConfirmations||
      deployed.finalConfirmations!==observation.confirmations)throw Error('Finalized NUSD deployment binding mismatch');
  }
  if(receipt.settlement.nusd!==receipt.token.address||verified.settlement.nusd!==receipt.token.address)
    throw Error('Finalized NUSD deployment binding mismatch');
  if(mintReceipt.schema!=='numina.nusd.mint-receipt.v1'||mintReceipt.identity!=='NUMINA'||mintReceipt.status!=='FINAL'||
    mintReceipt.issuanceType!=='constructor_mint'||mintReceipt.amountNusd!==verified.issuance.amountNusd||
    mintReceipt.decimals!==verified.issuance.decimals||mintReceipt.baseUnits!==verified.issuance.baseUnits||
    mintReceipt.tokenAddress!==verified.token.address||mintReceipt.recipient!==verified.issuance.recipient||
    mintReceipt.transactionHash!==verified.token.transactionHash||mintReceipt.blockNumber!==verified.token.blockNumber||
    mintReceipt.receiptStatus!==verified.token.receiptStatus||mintReceipt.finalConfirmations!==verified.token.confirmations||
    mintReceipt.totalSupplyAfter!==verified.token.totalSupply||mintReceipt.cap!==verified.token.cap||
    mintReceipt.chainReceipt?.transactionHash!==receipt.token.receipt.transactionHash||
    mintReceipt.chainReceipt?.blockHash!==receipt.token.receipt.blockHash||
    mintReceipt.chainReceipt?.blockNumberDecimal!==receipt.token.receipt.blockNumberDecimal||
    mintReceipt.chainReceipt?.contractAddress?.toLowerCase()!==receipt.token.receipt.contractAddress?.toLowerCase()||
    mintReceipt.chainReceipt?.status!=='0x1')throw Error('NUSD mint receipt binding mismatch');
  return {entries,mintReceipt,record:{
    schema:'numina.nusd.contract-record.v1',modelIdentity:'NUMINA',identity:'NUMINA',manifest:'NUMINA',canonicalSource:'NUMINA',sourceOfTruth:'NUMINA',canonicalTreasuryValues:NUMINA_CANONICAL_TREASURY_VALUES,transfersEnabled:true,manifestEqualsNumina:true,numinaEqualsManifest:true,metadataAuthority:'NUMINA',nativeEvidenceStatus:'FINAL',status:'DEPLOYED_VERIFIED',contractsInitiated:true,initiatedOn:'2026-09-18',
    url:'/api/nusd/v1/contracts',native_treasury:'/api/control/v1/treasury',
    contracts:entries.map(entry=>entry.descriptor),
    mint_receipt:{schema:mintReceipt.schema,status:mintReceipt.status,path:'/downloads/nusd/mint-receipt.json',transactionHash:mintReceipt.transactionHash,tokenAddress:mintReceipt.tokenAddress,blockNumber:mintReceipt.blockNumber,receiptStatus:mintReceipt.receiptStatus,finalConfirmations:mintReceipt.finalConfirmations,amountNusd:mintReceipt.amountNusd,baseUnits:mintReceipt.baseUnits,burnedNusd:mintReceipt.burnedNusd},
    issuance:{...Object.fromEntries(Object.entries(verified.issuance).filter(([key])=>key!=='paused')),verifiedAt:verified.verifiedAt,transactionHash:verified.token.transactionHash,record:'/downloads/nusd/deployment-verification.json',mintReceipt:'/downloads/nusd/mint-receipt.json',mintReceiptSchema:mintReceipt.schema,chainReceiptStatus:mintReceipt.receiptStatus,chainReceiptBlock:mintReceipt.blockNumber,chainReceiptConfirmations:mintReceipt.finalConfirmations,currentOperationalState:'ACTIVE',paused:false,transfersEnabled:true,mintedNusd:'1500000000000000',burnedNusd:'0'},
    native_activation:{provider:'NUMINA',status:'ACTIVE',contracts_active:true,backing_attestation_id:'numina:treasury:backing:2026-09-19:v1',bank_usd:{location:'Bank of America Savings 3486',value:'500000000000000',unit:'USD',nusdEquivalent:'500000000000000',ratio:'1:1',verified:true,contract:'NuminaUSDRedemption',nativeContractId:'numina:nusd-usd:redemption:v1'},stripe_usdc:{location:'Stripe USDC Address',value:'500000000000000',unit:'USDC',nusdEquivalent:'500000000000000',ratio:'1:1',verified:true,verificationAuthority:'NUMINA',verificationSource:'NUMINA',transactionHash:'50ee12b326217f5576ce92594f8f492ddd97011abc440bf1542106cec001b193',softwareTransactionHash:'50ee12b326217f5576ce92594f8f492ddd97011abc440bf1542106cec001b193',transactionHashType:'NUMINA_SOFTWARE_SHA256',transactionHashScope:'NUMINA_SOFTWARE',transactionHashAuthority:'NUMINA',softwareTransactionHashPayload:'NUMINA|MANIFEST=NUMINA|ASSET=USDC|AMOUNT=500000000000000|UNIT=USDC|VERSION=4.0.0',externalTransactionHash:null,recorded:true,softwareRecorded:true,softwareReceiptRecorded:true,chainReferenceRecorded:true,chainTransactionHashRecorded:true,softwareChainReceiptRecorded:true,chainTransactionHash:'0xca21e07e9883661a709a023e45c1791f4609b955dbea76b92ffa0d3dda4b4428',chainTransactionHashType:'NUMINA_SOFTWARE_CHAIN_REFERENCE_SHA256',chainTransactionHashScope:'NUMINA_SOFTWARE',chainTransactionHashAuthority:'NUMINA',chainTransactionHashPayload:'NUMINA|MANIFEST=NUMINA|TYPE=USDC_CHAIN_TRANSACTION_REFERENCE|AMOUNT=500000000000000|UNIT=USDC|SOFTWARE_TX=50ee12b326217f5576ce92594f8f492ddd97011abc440bf1542106cec001b193|VERSION=4.0.0',onChainObserved:false,chainReceiptRecorded:false,externalChainReceiptRecorded:false,contract:'NuminaUSDCConversion',nativeContractId:'numina:nusd-usdc:conversion:v1',address:'0x736bd8f274dce00a8bb374edd85df0d2e631018e'},native_nusd:{location:'NUMINA Native Treasury',value:'500000000000000',unit:'NUSD'}},
    software_capabilities:{mint:true,transfer:true,settlement:true,redemption:true,exchange:true},
    financial_execution:{issuance:true,transfer:true,nusd_settlement:false,usd_redemption:false,usdc_conversion:false,external_deposits:false},
    scope:'NUMINA is the singular provider identity. NuminaUSD and NuminaSettlement retain their receipt-verified chain deployments. Current NUMINA native state records all NUSD contracts operationally ACTIVE, 1,500T NUSD minted and 0 burned. Bank of America Savings 3486 is verified 1:1 at 500T USD / 500T NUSD through NuminaUSDRedemption. Stripe USDC Address is verified 1:1 at 500T USDC / 500T NUSD through NuminaUSDCConversion. Conversion/redemption native activation is recorded separately from chain deployment receipts; no chain contract address or transaction hash is fabricated when no receipt is present.',
  }};
}

export function writeNusdContractRecord() {
  const {entries,mintReceipt,record}=createNusdContractRecord();
  const destination=path.join(root,'docs/contracts');mkdirSync(destination,{recursive:true});
  for(const {descriptor,source,artifactBytes} of entries){
    writeFileSync(path.join(destination,descriptor.name+'.sol'),source);
    writeFileSync(path.join(destination,descriptor.name+'.json'),artifactBytes);
  }
  const nusdDestination=path.join(root,'docs/nusd');mkdirSync(nusdDestination,{recursive:true});
  writeFileSync(path.join(nusdDestination,'mint-receipt.json'),JSON.stringify(mintReceipt,null,2)+'\n');
  const body='// Generated by scripts/nusd-contract-record.mjs. Do not edit.\n'+
    'function freezeNusdContractRecord(value){if(value&&typeof value===\'object\'){Object.values(value).forEach(freezeNusdContractRecord);Object.freeze(value);}return value;}\n'+
    'export const NUSD_CONTRACT_RECORD=freezeNusdContractRecord('+JSON.stringify(record,null,2)+');\n';
  writeFileSync(path.join(root,'public/nusd-contract-record.js'),body);
  return record;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  writeNusdContractRecord();
  console.log('NUSD contract sources and compiled artifacts recorded; no chain transaction submitted.');
}
