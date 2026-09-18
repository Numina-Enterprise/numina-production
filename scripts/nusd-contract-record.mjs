import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

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
    status:'DEPLOYED_VERIFIED_PAUSED',
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

// Source uses LF UTF-8. Preserve compiler artifact bytes exactly, including the
// retained token artifact's formatting, so its deployment pin remains valid.
export function contractDescriptor(specification, sourceInput, artifactInput) {
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
  const verifiedDeployment=VERIFIED_DEPLOYMENTS[specification.id]??null;
  const descriptor = {
    id:specification.id, name:specification.name, status:verifiedDeployment?.status??'DEPLOYMENT_PREPARATION_INITIATED',
    source:{repository_path:`runtime/nusd/contracts/${specification.name}.sol`,
      url:`/downloads/contracts/${specification.name}.sol`,sha256:sha256(source),bytes:source.length,
      encoding:'UTF-8',line_endings:'LF'},
    artifact:{repository_path:`runtime/nusd/artifacts/${specification.name}.json`,
      url:`/downloads/contracts/${specification.name}.json`,sha256:sha256(artifactBytes),bytes:artifactBytes.length,
      encoding:'UTF-8',line_endings:artifactBytes.includes(Buffer.from('\r\n'))?'CRLF':'LF'},
    compiler:{version:artifact.compiler,settings:artifact.compilerSettings},
    implemented_operations:specification.operations,
    verification:{source_hash_matches_artifact:true,initiation_recorded:true,independent_security_audit:false,chain_receipt_verified:verifiedDeployment!==null},
    deployment:verifiedDeployment?{lifecycle:'FINAL',status:'verified',submission_performed:true,expected_chain_id:'962421430',contract_address:verifiedDeployment.contract_address,
      transaction_hash:verifiedDeployment.transaction_hash,block_number:verifiedDeployment.block_number,receipt:{status:verifiedDeployment.receipt_status,record:verifiedDeployment.receipt_record}}:
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
    read(path.join(root,`runtime/nusd/contracts/${specification.name}.sol`)),
    read(path.join(root,`runtime/nusd/artifacts/${specification.name}.json`))));
  // Keep the published source and artifact bound to the finalized deployed token.
  // UI precision must never select an old review artifact or rewrite chain evidence.
  const receipt=JSON.parse(read(path.join(root,'runtime/nusd/deployment-receipt.json')));
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
  return {entries,record:{
    schema:'numina.nusd.contract-record.v1',modelIdentity:'NUMINA',identity:'NUMINA',status:'DEPLOYED_VERIFIED',contractsInitiated:true,initiatedOn:'2026-09-18',
    url:'/api/nusd/v1/contracts',native_treasury:'/api/control/v1/treasury',
    contracts:entries.map(entry=>entry.descriptor),
    issuance:{...verified.issuance,verifiedAt:verified.verifiedAt,transactionHash:verified.token.transactionHash,record:'/downloads/nusd/deployment-verification.json'},
    financial_execution:{issuance:true,transfer:false,nusd_settlement:false,usd_redemption:false,
      usdc_conversion:false,external_deposits:false},
    scope:'NuminaUSD and NuminaSettlement are deployed and receipt-verified on the pinned NUMINA chain. The dated verification records a 1,500T constructor mint and paused state; it is not a live activity observation. USDC conversion and USD redemption contracts remain compiled but not deployed or activated; no external reserves, bank settlement, USDC liquidity or provider deposit is inferred.',
  }};
}

export function writeNusdContractRecord() {
  const {entries,record}=createNusdContractRecord();
  const destination=path.join(root,'docs/contracts');mkdirSync(destination,{recursive:true});
  for(const {descriptor,source,artifactBytes} of entries){
    writeFileSync(path.join(destination,descriptor.name+'.sol'),source);
    writeFileSync(path.join(destination,descriptor.name+'.json'),artifactBytes);
  }
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
