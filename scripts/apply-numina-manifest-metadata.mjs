import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {NUMINA_AUTHORIZED_BASE_USDC_DEPOSIT_INTENT as depositIntent,NUMINA_BASE_USDC_DESTINATION as destination,NUMINA_CANONICAL_TREASURY_VALUES as values,NUMINA_OWNER_PROVIDED_BANK_DEPOSIT_ALIGNMENT as bankAlignment,NUMINA_SINGULAR_SETTLEMENT_RECEIPT as receipt,NUMINA_TREASURY_JOURNAL_OBSERVATION as observation,NUMINA_TREASURY_CONNECTION as connection,NUSD_OPERATOR_ACTIVATION as activation} from '../public/treasury-connection-model.js';

// Synchronize current metadata projections. Journal events, historical evidence,
// provider observations, signatures and artifact bytes are never rewritten.
const root=new URL('../',import.meta.url);
const check=process.argv.includes('--check');
if(process.argv.slice(2).some(arg=>arg!=='--check'))throw Error('Usage: node scripts/apply-numina-manifest-metadata.mjs [--check]');
const read=path=>readFileSync(new URL(path,root),'utf8');
const json=path=>JSON.parse(read(path));
const blob=bytes=>createHash('sha1').update(Buffer.concat([Buffer.from('blob '+Buffer.byteLength(bytes)+'\0'),Buffer.from(bytes)])).digest('hex');
const currentPaths=[
  'package.json',
  'config/numina-metadata-overrides.v1.json','config/numina-manifest.v2.json',
  'config/numina-architecture.json',
  'public/business-core.json',
  'integrations/numina/package.json','integrations/numina/distribution.json',
  'integrations/numina/verification.json','integrations/numina/file-manifest.json'
];
const activeProvenancePolicy=json('config/active-provenance-policy.v1.json');
const provenanceFields=[
  'historicalEvidencePreserved','historicalEvidenceRewritten','rawExternalSourceEvidencePreserved',
  'providerObservationsSourceScoped','providerObservationsCanonical','providerObservationsAggregated',
  'externalProviderVerificationPromoted','retainSourceScopedProviderObservations',
  'softwareAmountConflictsOverwritten','rewritePerformed','providerConfirmationRequiresIndependentEvidence'
];
const provenanceBoundary=Object.fromEntries(provenanceFields.map(key=>[key,activeProvenancePolicy[key]]));

// Bind the shared constructor-mint projection to both retained receipts before
// emitting metadata. The later settlement-contract deployment is a distinct event.
const constructorMint=values.separateChainMintEvidence;
const mint=json(constructorMint.receipt),deployment=json(constructorMint.deploymentReceipt);
for(const key of ['identity','issuanceType','observedAt','chainId','tokenAddress','amountNusd','decimals','baseUnits','transactionHash','blockNumber','receiptStatus','finalConfirmations']){
  assert.equal(constructorMint[key],mint[key],'Constructor mint '+key);
}
assert.equal(mint.status,'FINAL','Constructor mint finality');
assert.equal(deployment.finality.status,'FINAL','Deployment finality');
assert.equal(mint.sourceDeploymentReceipt,constructorMint.deploymentReceipt,'Constructor mint deployment source');
assert.equal(deployment.chainId,constructorMint.chainId,'Deployment chain');
assert.equal(deployment.token.address,constructorMint.tokenAddress,'Deployment token');
assert.equal(deployment.token.transactionHash,constructorMint.transactionHash,'Deployment transaction');
assert.equal(deployment.issuance.constructorMint,true,'Constructor issuance');
for(const key of ['amountNusd','decimals','baseUnits'])assert.equal(deployment.issuance[key],constructorMint[key],'Deployment issuance '+key);
for(const chainReceipt of [mint.chainReceipt,deployment.token.receipt]){
  assert.equal(chainReceipt.transactionHash,constructorMint.transactionHash,'Constructor receipt transaction');
  assert.equal(chainReceipt.contractAddress.toLowerCase(),constructorMint.tokenAddress.toLowerCase(),'Constructor receipt contract');
  assert.equal(chainReceipt.blockNumberDecimal,constructorMint.blockNumber,'Constructor receipt decimal block');
  assert.equal(BigInt(chainReceipt.blockNumber).toString(),constructorMint.blockNumber,'Constructor receipt hex block');
  assert.equal(chainReceipt.status,constructorMint.receiptStatus,'Constructor receipt status');
}
assert.equal(deployment.token.finalConfirmations,constructorMint.finalConfirmations,'Constructor mint confirmations');
const settlementDeployment=constructorMint.settlementContractDeployment;
assert.equal(settlementDeployment.scope,'CONTRACT_DEPLOYMENT');
assert.equal(settlementDeployment.transactionHash,deployment.settlement.transactionHash,'Settlement deployment transaction');
assert.equal(settlementDeployment.contractAddress,deployment.settlement.address,'Settlement deployment contract');
assert.equal(settlementDeployment.blockNumber,deployment.settlement.receipt.blockNumberDecimal,'Settlement deployment block');
assert.equal(settlementDeployment.blockNumber,BigInt(deployment.settlement.receipt.blockNumber).toString(),'Settlement deployment hex block');
assert.equal(settlementDeployment.receiptStatus,deployment.settlement.receipt.status,'Settlement deployment status');
assert.notEqual(settlementDeployment.transactionHash,constructorMint.transactionHash,'Distinct deployment transactions');
assert.notEqual(settlementDeployment.blockNumber,constructorMint.blockNumber,'Distinct deployment blocks');
assert.equal(constructorMint.scope,'NUMINA_CHAIN_CONSTRUCTOR_ISSUANCE');
for(const key of ['currentChainStateVerified','currentJournalProjectionInferred','providerBackingVerified','providerSettlementVerified','externalDepositVerified']){
  assert.equal(constructorMint[key],false,'Constructor receipt does not establish '+key);
}

const native=json('runtime/nusd/treasury-settlement-receipt.json');
const validation=json('runtime/nusd/treasury-settlement-receipt-validation.json');
for(const path of ['runtime/nusd/treasury-settlement-receipt-validation.json','docs/nusd/treasury-settlement-receipt-validation.json',receipt.path]){
  const record=json(path);
  assert.deepEqual(record,validation,path+' validation copy');
  assert.equal(record.id,receipt.id,path+' validation ID');
  assert.equal(record.classification,'NUMINA_VERIFIED_ASSERTION',path+' assertion classification');
  assert.equal(record.assertionVerifiedBy,'NUMINA',path+' assertion authority');
  assert.equal(record.status,'NOT_SETTLED',path+' execution status');
  assert.equal(record.journalAuthentication.authenticated,false,path+' journal authentication');
  assert.equal(record.executionVerification.executionVerified,false,path+' execution verification');
  assert.equal(record.executionVerification.submissionPerformed,false,path+' submission');
  assert.equal(record.executionVerification.settlementPerformed,false,path+' settlement');
  assert.equal(record.authorization.executionAuthorized,true,path+' execution authorization');
  assert.equal(record.authorization.settlementAuthorized,true,path+' settlement authorization');
  assert.equal(record.authorization.journalAppendAuthorized,true,path+' append authorization');
}
assert.equal(native.id,receipt.validatedReceiptId,'Preserved historical receipt ID');
assert.equal(native.status,'SETTLED','Preserved historical assertion status');
assert.equal(validation.evaluatedReceipt.rawEvidenceImmutable,true,'Historical receipt bytes remain immutable');
assert.equal(native.components.find(item=>item.settledUnit==='USDC').usdcAddress,connection.nativeLocationBindings.stripeUsdc.usdcAddress,'Canonical Stripe USDC deposit address');
assert.equal(destination.address,connection.nativeLocationBindings.stripeUsdc.usdcAddress,'Aligned Base USDC destination');
assert.equal(destination.financialAccount,connection.nativeLocationBindings.stripeUsdc.financialAccount,'Aligned Stripe financial account');
assert.equal(depositIntent.destination,destination.address,'Authorized deposit destination');
assert.equal(values.status,'JOURNAL_SNAPSHOT');
assert.equal(values.canonical,false);
assert.equal(values.observation.observedRevision,observation.observedRevision);
assert.equal(values.observation.observedHead,observation.observedHead);
assert.equal(values.aggregate.current,observation.projection.balance);
assert.equal(native.aggregate.amountNusd,values.aggregate.modeledTarget);
assert.equal(native.components.length,3);
assert.equal(values.componentCount,3);
assert.equal(values.treasuryCount,1);
assert.equal(values.accountCount,1);
assert.equal(values.balanceCount,1);
assert.equal(values.mintStatus,'PREPARED_IN_JOURNAL');
assert.equal(values.mintedNusd,null);
assert.equal(values.components.USD.current,null);
assert.equal(values.components.USDC.current,null);
assert.equal(values.components.USD.available,null);
assert.equal(values.components.USDC.available,null);
assert.equal(native.mintEvidence.mintedNusd,values.separateChainMintEvidence.amountNusd);
assert.equal(native.mintEvidence.transactionHash,receipt.mintTransactionHash);
assert.equal(native.components.reduce((sum,item)=>sum+BigInt(item.amountNusd),0n).toString(),values.aggregate.modeledTarget);
for(const item of native.components){
  assert.equal(item.settlementReceiptId,receipt.validatedReceiptId);
  assert.equal(item.status,'SETTLED');
  assert.equal(item.settledAmount,values.components[item.settledUnit].modeledTarget??values.components[item.settledUnit].current);
}

const planned=new Map(),records=new Map();
function updateValues(value){
  if(Array.isArray(value)){value.forEach(updateValues);return;}
  if(!value||typeof value!=='object')return;
  if(value.historicalRecord===true)return;
  for(const key of Object.keys(value)){
    const item=value[key];
    if(/^(historical|retained)/i.test(key)||['approved_review','simulation'].includes(key))continue;
    if(key==='canonicalTreasuryValues'||key==='canonicalValues'&&item?.schema==='numina.canonical-treasury-values.v1'){
      value[key]=structuredClone(values);
    }else if(key==='singularSettlementReceipt'&&(item?.id===receipt.id||item?.id===receipt.validatedReceiptId)){
      value.historicalSettlementReceipt={...item,historicalRecord:true,currentJournalConfirmed:false};
      value.settlementReceiptValidation=structuredClone(receipt);
      delete value[key];
    }else if(key==='allocationInstruction'&&item?.schema==='numina.treasury.allocation-instruction.v1'){
      value.historicalAllocationInstruction={...item,historicalRecord:true,currentJournalConfirmed:false};
      delete value[key];
    }else updateValues(item);
  }
  if((value.unit==='USD'||value.unit==='USDC')&&value.current==='500000000000000'&&value.available==='500000000000000'){
    value.modeledTarget=value.current;
    value.current=null;
    value.available=null;
  }
  if(value.unit==='NUSD'&&value.current==='500000000000000'&&value.available==='500000000000000'){
    value.available=null;
    value.observationRevision=observation.observedRevision;
  }
  if(value.unit==='NUSD'&&value.current==='1500000000000000'){
    value.modeledTarget=value.current;
    value.current=observation.projection.balance;
    if(Object.hasOwn(value,'available'))value.available=null;
    value.observationRevision=observation.observedRevision;
  }
  if(Object.hasOwn(value,'transfersEnabled'))value.transfersEnabled=null;
  if(Object.hasOwn(value,'provider_verification'))value.provider_verification=null;
  if(value.canonicalTreasuryValues){
    for(const field of ['canonicalTreasuryValueStatus','nativeEvidenceStatus','manifestStatus']){
      if(Object.hasOwn(value,field))value[field]='JOURNAL_SNAPSHOT';
    }
    value.currentChainStateVerified=false;
  }
}
function serialize(path,value){
  const newline=read(path).includes('\r\n')?'\r\n':'\n';
  return (JSON.stringify(value,null,2)+'\n').replace(/\n/g,newline);
}
for(const path of currentPaths){
  const data=json(path);
  data.canonicalTreasuryValues=structuredClone(values);
  updateValues(data);
  data.treasuryJournalObservation=structuredClone(observation);
  data.authoritativeCurrentTreasuryRoute=observation.authoritativeCurrentRoute;
  data.activeProvenancePolicy=structuredClone(activeProvenancePolicy);
  data.metadataAlignment={authority:'NUMINA',softwareSourceOfTruth:'NUMINA_NATIVE_TREASURY_JOURNAL',record:'/metadata-alignment.json',constructorMintBlock:constructorMint.blockNumber,settlementContractDeploymentBlock:settlementDeployment.blockNumber,baseUsdcDestination:structuredClone(destination),authorizedDepositIntent:structuredClone(depositIntent),ownerProvidedBankDepositAlignment:structuredClone(bankAlignment),settlementReceiptValidation:structuredClone(receipt),...provenanceBoundary};
  records.set(path,data);
}
const architecture=records.get('config/numina-architecture.json');
const priorMint=architecture.historical_mint_event??architecture.mint_event;
architecture.historical_mint_event={...priorMint,status:'HISTORICAL_CHAIN_RECEIPT',historicalRecord:true,currentJournalConfirmed:false,currentChainStateVerified:false,observedAt:constructorMint.observedAt,chain_id:constructorMint.chainId,contract_address:constructorMint.tokenAddress,transaction_hash:constructorMint.transactionHash,block_number:constructorMint.blockNumber,receipt_status:constructorMint.receiptStatus,amount_nusd:constructorMint.amountNusd,decimals:constructorMint.decimals,base_units:constructorMint.baseUnits,mint_receipt:constructorMint.download,settlement_contract_deployment:structuredClone(settlementDeployment)};
architecture.mint_event=null;
architecture.mintStatus=values.mintStatus;
architecture.mint_request={...observation.requests.find(item=>item.kind==='mint_request'),observedRevision:observation.observedRevision,snapshotIsLive:false};
Object.assign(architecture.treasury,{verification:'JOURNAL_SNAPSHOT',verificationScope:'JOURNAL_CONTINUITY_AT_OBSERVATION',provider_verification:null,providerBalancesVerified:false,modeled_role_values_additive:false,aggregate_modeled_value:null,projection:observation.projection.balance});
const override=records.get('config/numina-metadata-overrides.v1.json');
override.resolution.treasurySettlement=null;
override.resolution.historicalTreasurySettlement=receipt.validatedReceiptId;
override.resolution.treasurySettlementValidation=receipt.id;
override.canonicalSettlementAppliesTo='NONE_WITHOUT_MATCHING_JOURNAL_EVENT';
// The archive retains byte-pinned FINAL releases and source-scoped receipts.
// Only mutable current projections are synchronized; execution gates and source
// modules are never rewritten by text substitutions.
for(const [path,data] of records)planned.set(path,serialize(path,data));
const changed=[...planned].filter(([path,body])=>read(path)!==body);
if(check){
  console.log(JSON.stringify({identity:'NUMINA',receiptId:receipt.id,consistent:changed.length===0,staleFiles:changed.map(([path])=>path)}));
  if(changed.length)process.exitCode=1;
}else{
  for(const [path,body] of changed)writeFileSync(fileURLToPath(new URL(path,root)),body);
  console.log(JSON.stringify({identity:'NUMINA',receiptId:receipt.id,updatedFiles:changed.map(([path])=>path),frozenArtifactsPreserved:true,sourceModulesPreserved:true,providerExecutionPerformed:false}));
}
