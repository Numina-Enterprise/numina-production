// Source-published release gate. Form input and wallet consent cannot approve it.
const executionFreeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(executionFreeze);Object.freeze(value);}return value;};
export const WALLET_EXECUTION_POLICY=executionFreeze({
 schema:'numina.nusd.wallet-execution-policy.v1',status:'BLOCKED',submissionAllowed:false,
 requestSha256:'0af2b7e72cd18f9676f85356da95f8deee8788eac0dee3d587a1278342a401ca',
 artifactSha256:'a77132febebe10172a7fe3ee1814ed124ea5503b93f1e2e4ffdfb218889a262a',
 issuerPolicySha256:'1d24f311a34a28d9560db1f32eb3efc4241701c5ae7233b97c2527006623b13d',
 creationSha256:'bdaf4313f68b97d504ef3796096814d41b3002bffcf9ed75b78a939de6049401',
 chainId:'962421430',genesisHash:'0xea95dac2ad854c835bc526d6be70a5a4614ccd47412a4bc710308b41010b53e1',
 sender:'0x1a45671AE2ee3E52264116151924FAAcb80Fc02E',initialSupplyBaseUnits:'1500000000000000000000',
 issuerPolicySigned:false,ownerApproved:false,reviewEvidenceVerified:false,
 reviews:['independentSecurityAudit','authorizedIssuerAndJurisdictions','custodianAndReserveEvidence','redeemabilityTermsAndOperations','financialCrimeAndSanctionsControls','independentRoleKeyCustody','incidentAndPauseRecovery','applicationSettlementAndFulfillmentReview'].map(id=>({id,verified:false,evidenceSha256:null})),
 blockers:['The revised 1,500T issuer policy is unsigned.','Eight production reviews lack verified supporting records.'],
 minimumConfirmations:12,fundsVerified:false,providerDepositsEnabled:false
});
export function walletExecutionAuthorized(policy=WALLET_EXECUTION_POLICY){
 const base=WALLET_EXECUTION_POLICY;
 return policy?.schema===base.schema&&policy.status==='APPROVED_FOR_OWNER_WALLET'&&policy.submissionAllowed===true&&policy.issuerPolicySigned===true&&policy.ownerApproved===true&&policy.reviewEvidenceVerified===true
  &&['requestSha256','artifactSha256','issuerPolicySha256','creationSha256','chainId','genesisHash','sender','initialSupplyBaseUnits'].every(key=>policy[key]===base[key])
  &&Array.isArray(policy.reviews)&&policy.reviews.length===base.reviews.length&&base.reviews.every(({id})=>policy.reviews.filter(r=>r?.id===id&&r.verified===true&&typeof r.evidenceSha256==='string'&&/^[a-f0-9]{64}$/.test(r.evidenceSha256)).length===1)
  &&policy.minimumConfirmations>=12&&Number.isSafeInteger(policy.minimumConfirmations);
}
