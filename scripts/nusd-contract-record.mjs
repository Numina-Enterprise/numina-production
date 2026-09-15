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
  const descriptor = {
    id:specification.id, name:specification.name, status:'compiled_not_deployed',
    source:{repository_path:`runtime/nusd/contracts/${specification.name}.sol`,
      url:`/downloads/contracts/${specification.name}.sol`,sha256:sha256(source),bytes:source.length,
      encoding:'UTF-8',line_endings:'LF'},
    artifact:{repository_path:`runtime/nusd/artifacts/${specification.name}.json`,
      url:`/downloads/contracts/${specification.name}.json`,sha256:sha256(artifactBytes),bytes:artifactBytes.length,
      encoding:'UTF-8',line_endings:artifactBytes.includes(Buffer.from('\r\n'))?'CRLF':'LF'},
    compiler:{version:artifact.compiler,settings:artifact.compilerSettings},
    implemented_operations:specification.operations,
    verification:{source_hash_matches_artifact:true,independent_security_audit:false,chain_receipt_verified:false},
    deployment:{status:'not_verified',expected_chain_id:'962421430',contract_address:null,
      transaction_hash:null,receipt:null},
  };
  return {descriptor,source,artifactBytes};
}

export function createNusdContractRecord(read=readFileSync) {
  const entries=specifications.map(specification=>contractDescriptor(specification,
    read(path.join(root,`runtime/nusd/contracts/${specification.name}.sol`)),
    read(path.join(root,`runtime/nusd/artifacts/${specification.name}.json`))));
  return {entries,record:{
    schema:'numina.nusd.contract-record.v1',status:'compiled_not_deployed',
    url:'/api/nusd/v1/contracts',native_treasury:'/api/control/v1/treasury',
    contracts:entries.map(entry=>entry.descriptor),
    financial_execution:{issuance:false,transfer:false,nusd_settlement:false,usd_redemption:false,
      usdc_conversion:false,external_deposits:false},
    scope:'Compiled NUSD token, settlement, inventory-backed 1:1 USDC conversion and 1:1 USD redemption escrow candidates. USD settlement requires a separate bank payment and a trusted confirmer attestation. Source and artifact hashes do not establish deployed contracts, reserves, activated conversion or external deposits.',
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
