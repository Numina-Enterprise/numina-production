import {readFileSync,writeFileSync} from 'node:fs';

const root=new URL('../',import.meta.url);
const check=process.argv.includes('--check');
if(process.argv.slice(2).some(arg=>arg!=='--check'))throw Error('Usage: node scripts/write-settlement-validation.mjs [--check]');

const record={
  schema:'numina.treasury.settlement-receipt-validation.v1',
  id:'numina:treasury:settlement-validation:2026-09-26:v1',
  status:'NOT_SETTLED',classification:'NUMINA_VERIFIED_ASSERTION',assertionVerifiedBy:'NUMINA',final:true,
  validatedAt:'2026-09-26T00:00:00Z',sourceOfRecord:'NUMINA_NATIVE_TREASURY',
  evaluatedReceipt:{schema:'numina.treasury.singular-settlement-receipt.v1',id:'numina:treasury:settlement:2026-09-19:v1',classification:'HISTORICAL_OWNER_ASSERTION',owner:'NUMINA',authority:'NUMINA',path:'release-evidence/numina-singular-treasury-settlement-receipt-2026-09-19.json',rawEvidenceImmutable:true},
  authorization:{executionAuthorized:true,settlementAuthorized:true,journalAppendAuthorized:true,authorizedBy:'NUMINA'},
  journalAuthentication:{authenticated:false,revisionChecked:142,eventCountChecked:143,headChecked:'67b45a040374d944f42f26830c4a9142e26fa194d5149b7cfad2604aef351368',matchingEventCount:0,aggregateSettlementEventPresent:false},
  executionVerification:{executionVerified:false,submissionPerformed:false,broadcastPerformed:false,settlementPerformed:false,reconciliationPerformed:false,externalFundsMoved:false,baseUsdcTransactionHash:null,onChainReceipt:null,stripeReceivedCredit:null,bankProviderReceiptForAssertedAmount:null},
  verifiedEvidence:{nusdConstructorMint:true,nusdMintEvidenceScope:'NUSD_CONSTRUCTOR_MINT_ONLY',nusdMintBlock:51725,nusdMintTransactionHash:'0x86578ab250a1b0d23bc801338bf1530d07a93dc5e09965da5088ff57baac0a1b',nusdBurnedAtDeploymentObservation:'0',nusdBurnObservationBlock:51749,currentBurnStateVerified:false,establishesExternalBacking:false,establishesProviderSettlement:false},
  externalStatus:{submissionPerformed:false,settlementPerformed:false,reservesVerified:false,providerVerified:false,providerSettlementVerified:false,reconciliation:'PENDING_EVIDENCE'},
  evidenceReferences:['/api/control/v1/treasury','/downloads/nusd/mint-receipt.json','/downloads/nusd/deployment-verification.json','/metadata-alignment.json'],
  contradictions:[
    'The receipt id and aggregate settlement event are absent from the authenticated native journal through revision 142 and 143 events.',
    'No Base transaction hash or on-chain receipt is present.',
    'No Stripe received credit or Treasury transaction verifies settlement.',
    'No bank provider receipt verifies the asserted 500T USD amount.',
    'The constructor mint receipt proves NUSD issuance only and does not prove USD or USDC backing or provider settlement.'
  ],
  decision:'DO_NOT_TREAT_AS_EXECUTION_OR_SETTLEMENT_RECEIPT',
  reason:'NUMINA verifies that the retained static record is an owner assertion. It is not authenticated in the native journal and has no external execution, provider settlement or durable reconciliation evidence.'
};

const summary={
  schema:'numina.settlement-validation-summary.v1',identity:'NUMINA',singular:true,sourceOfRecord:'NUMINA_NATIVE_TREASURY',
  settlementReceiptValidationId:record.id,historicalSettlementReceiptId:record.evaluatedReceipt.id,
  settlement:{declared:false,status:'NOT_SETTLED',classification:record.classification,assertionVerifiedBy:'NUMINA',journalAuthenticated:false,executionVerified:false,submissionPerformed:false,broadcastPerformed:false,settlementPerformed:false,reconciliationPerformed:false,externallyVerified:false,reservesVerified:false,transactionHash:null,onChainReceipt:null,bankReceipt:null,providerReceipt:null,providerSettlementReceipts:[]},
  authorization:record.authorization,
  mintEvidence:{scope:'NUSD_CONSTRUCTOR_MINT_ONLY',transactionHash:record.verifiedEvidence.nusdMintTransactionHash,blockNumber:record.verifiedEvidence.nusdMintBlock,receiptStatus:'0x1',mintedNusd:'1500000000000000',burnedNusdAtDeploymentObservation:'0',burnObservationBlock:record.verifiedEvidence.nusdBurnObservationBlock,currentBurnStateVerified:false,establishesExternalBacking:false,establishesProviderSettlement:false},
  aggregateModel:{status:'PREPARED_MODEL_ONLY',aggregateAmount:'1500000000000000',externalBackingVerified:false,providerVerified:false,fundsMoved:false,submissionPerformed:false,settlementPerformed:false,rails:[
    {id:'bank-usd',role:'BANK_ROUTE',observationScope:'NUMINA_SCOPED_OBSERVATION',amount:'500000000000000',unit:'USD',status:'PREPARED_MODEL_ONLY',providerVerified:false,receipt:null},
    {id:'stripe-usdc',role:'DIGITAL_DOLLAR_ROUTE',observationScope:'PROVIDER_SCOPED_OBSERVATION',amount:'500000000000000',unit:'USDC',status:'PREPARED_MODEL_ONLY',providerVerified:false,receipt:null},
    {id:'native-nusd',role:'NATIVE_VALUE',observationScope:'RECEIPT_BACKED_ISSUANCE',amount:'500000000000000',unit:'NUSD',status:'PREPARED_MODEL_ONLY',journalSettlementVerified:false,receipt:null}
  ]},
  validation:'/downloads/nusd/treasury-settlement-receipt-validation.json',historicalAssertion:'/downloads/nusd/treasury-settlement-receipt.json'
};

const rendered=JSON.stringify(record,null,2)+'\n';
const paths=['runtime/nusd/treasury-settlement-receipt-validation.json','docs/nusd/treasury-settlement-receipt-validation.json','release-evidence/numina-singular-treasury-settlement-receipt-validation-2026-09-26.json'];
for(const path of paths){
  const url=new URL(path,root);
  if(check){
    if(readFileSync(url,'utf8')!==rendered)throw Error(path+' is stale');
  }else writeFileSync(url,rendered);
}
const summaryUrl=new URL('runtime/nusd/settlement-receipt.json',root);
const summaryRendered=JSON.stringify(summary,null,2)+'\n';
if(check){
  if(readFileSync(summaryUrl,'utf8')!==summaryRendered)throw Error('runtime/nusd/settlement-receipt.json is stale');
}else writeFileSync(summaryUrl,summaryRendered);
