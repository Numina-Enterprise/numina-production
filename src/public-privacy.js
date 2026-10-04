// Public metadata is a projection. Original evidence and owner operations retain
// their exact private source records and authentication requirements.
const privateMetadataKeys = new Set([
  'accountLast4','linkedAccountLast4','providerAccountLast4','achRoutingNumber','routingReference',
  'stripeAccount','financialAccount','financialAddress','linkedFinancialAccount','linkedStripeAccount',
  'destinationFinancialAccount','destinationFinancialAddress','destination_financial_account','destination_financial_address',
  'providerAccountReference','bankObservation','retainedProviderObservation','historicalTransfer',
  'historicalSoftwareTransfer','historical_software_transfer','bankSoftwareTransfer','software_transfer',
  'ownerProvidedBankDepositAlignment','journalObservation','historicalJournalObservation',
  'historical_mint_request','observedMintRequest','requests','transaction_requests',
  'confirmation','assertedConfirmation','providerConfirmation','transactionId','providerTransactionId',
  'observedProviderTransactionAmount','observedProviderBalance','providerClearedDate','providerBalance',
  'amountUsd','assertedClearedDate','assertedCleared','clearedDate',
  'providerBalanceAtObservation','providerInboundPendingAtObservation','providerReceivedCreditsAtObservation',
  'historicalJournalProjection'
]);
export function publicMetadataText(value){
  return value.replace(/\b(?:acct|fa|finaddr)_[A-Za-z0-9]+\b/g,'PRIVATE_ACCOUNT')
    .replace(/\b((?:Savings|account)(?:\s|[:#·-])+)[0-9]{4}\b/gi,'$1[private]');
}
export function publicMetadata(value,key=''){
  if(privateMetadataKeys.has(key))return Array.isArray(value)?[]:null;
  if(value?.schema==='numina.treasury.journal-observation.v1')return {schema:value.schema,asOfDate:value.asOfDate,observedRevision:value.observedRevision,snapshotIsLive:false,requests:[],publicSummary:'/journal-summary.json'};
  if(Array.isArray(value))return value.map(item=>publicMetadata(item));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([name,item])=>[name,publicMetadata(item,name)]));
  return typeof value==='string'?publicMetadataText(value):value;
}
