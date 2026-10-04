import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {NUMINA_AGGREGATE_MODEL_PREPARED_REQUEST_SCHEMA,NUMINA_AUTHORIZED_BASE_USDC_DEPOSIT_INTENT,NUMINA_BASE_USDC_DESTINATION,NUMINA_CANONICAL_TREASURY_VALUES,NUMINA_OWNER_PROVIDED_BANK_DEPOSIT_ALIGNMENT,NUMINA_TREASURY_JOURNAL_OBSERVATION} from '../public/treasury-connection-model.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const roots=['release-evidence','runtime/nusd','docs/nusd','docs/provenance','integrations/numina/history','reference'];
const retainedFiles=['config/treasury-aggregate-settlement-1500t.v1.json'];
// Package licenses are maintained source configuration, not immutable evidence.
const maintainedPackageInputs=new Set(['runtime/nusd/package.json','runtime/nusd/package-lock.json','runtime/nusd/development/package.json','runtime/nusd/development/package-lock.json']);
function collect(relative){
  return readdirSync(path.join(root,relative),{withFileTypes:true}).flatMap(entry=>{
    const item=relative+'/'+entry.name;
    if(entry.isSymbolicLink()||entry.name==='node_modules')return [];
    if(entry.isDirectory())return collect(item);
    return /\.(?:json|jsonl)$/.test(item)?[item]:[];
  });
}
function scope(file){
  if(maintainedPackageInputs.has(file))return 'MAINTAINED_SOURCE_CONFIGURATION';
  if(file.endsWith('/mint-receipt.json'))return 'CONFIRMED_CONSTRUCTOR_MINT_AT_OBSERVATION';
  if(/\/(deployment-receipt|deployment-verification)\.json$/.test(file))return 'DATED_CHAIN_DEPLOYMENT_OBSERVATION';
  if(file.includes('/provenance/'))return 'RETAINED_BUILD_PROVENANCE';
  if(file.startsWith('reference/'))return 'RETAINED_BUILD_BASELINE';
  if(file.includes('/history/'))return 'HISTORICAL_INTEGRATION_VERSION';
  if(file.includes('/reviews/')||/template|request|preparation|approval|handoff/.test(file))return 'PROPOSAL_REVIEW_OR_PREPARATION_INPUT';
  if(file.includes('/artifacts/'))return 'COMPILED_CONTRACT_INPUT';
  return 'RETAINED_SOURCE_SCOPED_RECORD';
}
export function createMetadataAlignment(){
  const activeProvenancePolicy=JSON.parse(readFileSync(path.join(root,'config/active-provenance-policy.v1.json'),'utf8'));
  const mint=structuredClone(NUMINA_CANONICAL_TREASURY_VALUES.separateChainMintEvidence);
  const receipt=JSON.parse(readFileSync(path.join(root,mint.receipt),'utf8'));
  for(const key of ['blockNumber','transactionHash','tokenAddress','chainId','amountNusd','decimals','receiptStatus'])assert.equal(mint[key],receipt[key]);
  const records=[...roots.flatMap(collect),...retainedFiles].sort().map(file=>{
    const bytes=readFileSync(path.join(root,file));
    return {path:file,bytes:bytes.length,sha256:sha256(bytes),scope:scope(file),originalBytesPreserved:!maintainedPackageInputs.has(file),currentBalanceOrReadinessInferred:false,currentInterpretation:'/metadata-alignment.json'};
  });
  return {
    schema:'numina.metadata-alignment.v1',identity:'NUMINA',metadataAuthority:'NUMINA',
    sourceOfTruth:'NUMINA',softwareSourceOfTruth:'NUMINA_NATIVE_TREASURY_JOURNAL',
    authoritativeCurrentTreasuryRoute:'/api/control/v1/treasury',
    canonicalConstructorMint:mint,
    currentTreasuryState:structuredClone(NUMINA_CANONICAL_TREASURY_VALUES.currentState),
    journalObservation:structuredClone(NUMINA_TREASURY_JOURNAL_OBSERVATION),
    baseUsdcDestination:structuredClone(NUMINA_BASE_USDC_DESTINATION),
    authorizedDepositIntent:structuredClone(NUMINA_AUTHORIZED_BASE_USDC_DEPOSIT_INTENT),
    aggregateModelPreparationSchema:structuredClone(NUMINA_AGGREGATE_MODEL_PREPARED_REQUEST_SCHEMA),
    ownerProvidedBankDepositAlignment:structuredClone(NUMINA_OWNER_PROVIDED_BANK_DEPOSIT_ALIGNMENT),
    currentChainStateVerified:false,providerBackingVerified:false,providerSettlementVerified:false,
    activeProvenancePolicy,
    historicalInterpretation:{
      archivedRecordsAreTimeScoped:true,signaturesOrArchivedClaimsRewritten:false,
      earlier500TReview:{supplyNusd:'500000000000000',decimals:6,scope:'HISTORICAL_UNDEPLOYED_REVIEW_AND_SIMULATION',currentDeployedToken:false},
      constructorMint:{block:'51725',amountNusd:'1500000000000000',decimals:18,scope:'CONSTRUCTOR_ISSUANCE_AT_RETAINED_OBSERVATION'},
      settlementContractDeployment:{block:'51726',scope:'CONTRACT_CREATION',providerSettlementInferred:false},
      three500TAllocations:{scope:'HISTORICAL_ALLOCATION_STATEMENTS',summedIntoCurrentJournal:false,providerBalancesInferred:false},
      precedence:'Use the authenticated native journal for current software state, the retained constructor receipt for the dated mint, and provider records for their own balances and settlement. Prior review, model, build and attestation claims keep their original scope.'
    },
    currentViews:['/api/nusd/v1/mint-workflow','/api/nusd/v1/status','/api/nusd/v1/contracts','/downloads/application-release-v4.json','/source-alignment.json','/business-core.json'],
    frozenReleaseRecords:['/final-build.json','/final-manifest.json','/current-environments.json'],
    frozenReleaseRecordsAreCurrentState:false,
    retainedInventory:{roots,retainedFiles,extensions:['json','jsonl'],recordCount:records.length,records},
    executionEffects:{journalWrite:false,tokenIssuance:false,conversion:false,externalDeposit:false,reconciliation:false},
    documentation:'/downloads/Numina-Metadata-Alignment-v4.md'
  };
}
export function writeMetadataAlignment({check=false}={}){
  const record=createMetadataAlignment(),body=JSON.stringify(record,null,2)+'\n';
  const outputs=['public/metadata-alignment.json','docs/Numina-Metadata-Alignment-v4.json'];
  const stale=outputs.filter(file=>!existsSync(path.join(root,file))||readFileSync(path.join(root,file),'utf8')!==body);
  if(!check)for(const file of stale)writeFileSync(path.join(root,file),body);
  return {identity:'NUMINA',retainedRecords:record.retainedInventory.recordCount,consistent:stale.length===0,staleFiles:stale};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const check=process.argv.includes('--check'),result=writeMetadataAlignment({check});
  console.log(JSON.stringify(result));if(check&&!result.consistent)process.exitCode=1;
}
