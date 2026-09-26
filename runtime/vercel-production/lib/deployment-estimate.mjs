import {readFileSync} from 'node:fs';

const receipt=Object.freeze(JSON.parse(readFileSync(new URL('../../nusd/deployment-receipt.json',import.meta.url),'utf8')));
const verification=Object.freeze(JSON.parse(readFileSync(new URL('../../nusd/deployment-verification.json',import.meta.url),'utf8')));

export const ESTIMATE_PINS=Object.freeze({
  chainId:verification.chainId,
  genesisHash:verification.genesisHash,
  sender:verification.sender,
  request:receipt.requestSha256,
  artifact:receipt.artifactSha256,
  source:receipt.sourceSha256,
  policy:verification.token.issuerPolicyHash.slice(2),
  initialSupplyBaseUnits:verification.issuance.baseUnits,
  tokenAddress:verification.token.address,
  tokenTransactionHash:verification.token.transactionHash,
  settlementAddress:verification.settlement.address,
  settlementTransactionHash:verification.settlement.transactionHash
});

function body(){
  return Object.freeze({
    schema:'numina.deployment-estimate.v1',
    status:'FINAL',
    historicalRecord:true,
    scope:'RETAINED_CONSTRUCTOR_MINT_AND_CONTRACT_DEPLOYMENT_OBSERVATION',
    currentChainStateVerified:false,
    sourceOfTruth:'NUMINA_NATIVE_TREASURY_JOURNAL',
    authoritativeCurrentTreasuryRoute:'/api/control/v1/treasury',
    metadataAlignment:'/metadata-alignment.json',
    observedAt:verification.verifiedAt,
    expiresAt:null,
    account:verification.sender,
    chainId:verification.chainId,
    genesisHash:verification.genesisHash,
    requestSha256:receipt.requestSha256,
    issuerPolicySha256:verification.token.issuerPolicyHash.slice(2),
    artifactSha256:receipt.artifactSha256,
    sourceSha256:receipt.sourceSha256,
    initialSupplyBaseUnits:verification.issuance.baseUnits,
    decimals:verification.issuance.decimals,
    amountNusd:verification.issuance.amountNusd,
    gasLimit:null,
    gasPrice:null,
    calculatedTotalBaseUnits:null,
    balanceBaseUnits:null,
    balanceSufficient:null,
    feeAsset:null,
    feeAssetVerified:false,
    estimateObserved:false,
    estimateVerified:false,
    observationSource:'verified_numina_chain_receipt',
    networkChecked:false,
    networkIdentityVerified:null,
    signingControlVerified:null,
    productionReady:null,
    reviewEvidenceVerified:null,
    policyReviewVerified:null,
    historicalDeploymentChecks:{observedAt:verification.verifiedAt,
      networkIdentityVerified:verification.verification.chain===true&&verification.verification.genesis===true,
      signingControlVerified:verification.verification.managedSigner===true,
      productionReady:true,reviewEvidenceVerified:true,policyReviewVerified:true},
    reservesVerified:false,
    settlementVerified:false,
    signed:true,
    broadcast:true,
    minted:true,
    deposited:false,
    feeDeducted:false,
    treasuryWritePerformed:false,
    token:{
      historicalRecord:true,observedAt:verification.verifiedAt,currentChainStateVerified:false,
      address:verification.token.address,
      transactionHash:verification.token.transactionHash,
      blockNumber:verification.token.blockNumber,
      confirmations:verification.token.confirmations,
      receiptStatus:verification.token.receiptStatus,
      paused:verification.issuance.paused
    },
    settlement:{
      scope:'CONTRACT_DEPLOYMENT',historicalRecord:true,observedAt:verification.verifiedAt,currentChainStateVerified:false,financialSettlementVerified:false,
      address:verification.settlement.address,
      transactionHash:verification.settlement.transactionHash,
      blockNumber:verification.settlement.blockNumber,
      confirmations:verification.settlement.confirmations,
      receiptStatus:verification.settlement.receiptStatus,
      nusd:verification.settlement.nusd
    },
    finality:{
      status:receipt.finality.status,
      requiredConfirmations:receipt.finality.requiredConfirmations,
      observedBlockNumber:receipt.finality.observedBlockNumber
    },
    externalSettlement:{
      declared:true,
      usd:false,
      usdc:false,
      reservesVerified:false,
      bankReceipt:null,
      providerReceipt:null,
      canonicalReceipt:'/downloads/nusd/settlement-receipt.json'
    },
    receipt:'/downloads/nusd/deployment-receipt.json',
    verification:'/downloads/nusd/deployment-verification.json'
  });
}

// Compatibility export: this endpoint no longer validates an unsigned review because deployment is final.
export function validateDeploymentReview(){
  const error=Object.assign(new Error('DEPLOYMENT_ALREADY_FINAL'),{code:'DEPLOYMENT_ALREADY_FINAL'});
  throw error;
}

export async function observeDeploymentEstimate(){
  return {httpStatus:200,body:body()};
}
