import {NUMINA_OWNER_APPROVAL} from './owner-approval.js';
// Source-published release gate. Form input and wallet consent cannot approve it.
const executionFreeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(executionFreeze);Object.freeze(value);}return value;};
export const WALLET_EXECUTION_POLICY=executionFreeze({
 schema:'numina.nusd.wallet-execution-policy.v1',status:'BLOCKED',submissionAllowed:false,
 requestSha256:'b55cf6c460c0d69ea29645a6bfcfee03b88a4ed2b77b2e3f44ed53ea325956c4',
 artifactSha256:'3e9d8f22014cb1a2496cba9bef334b0146a073c07d84382752a31d586d7658c2',
 issuerPolicySha256:'2134617c4fb7a538271dcf6b3b4bfa10fc71c23631a9cf63c7d0a05ee05294f5',
 creationSha256:'1b07ec294a2fe3d38f12d2458efde3cbdeadc056ea096db0ee665ec68173906a',
 chainId:'962421430',genesisHash:'0xea95dac2ad854c835bc526d6be70a5a4614ccd47412a4bc710308b41010b53e1',
 sender:'0x1a45671AE2ee3E52264116151924FAAcb80Fc02E',decimals:18,initialSupplyNusd:'1500000000000000',initialSupplyBaseUnits:'1500000000000000000000000000000000',
 issuerPolicySigned:false,ownerApproved:NUMINA_OWNER_APPROVAL.approved&&NUMINA_OWNER_APPROVAL.requestSha256==='b55cf6c460c0d69ea29645a6bfcfee03b88a4ed2b77b2e3f44ed53ea325956c4',ownerApprovalId:NUMINA_OWNER_APPROVAL.id,reviewEvidenceVerified:false,
 reviews:['independentSecurityAudit','authorizedIssuerAndJurisdictions','custodianAndReserveEvidence','redeemabilityTermsAndOperations','financialCrimeAndSanctionsControls','independentRoleKeyCustody','incidentAndPauseRecovery','applicationSettlementAndFulfillmentReview'].map(id=>({id,verified:false,evidenceSha256:null})),
 blockers:['Managed NUMINA deployment is authorized, but browser-wallet submission stays closed until production network receipt reconciliation.','Independent security, reserve, and external settlement evidence remain separate from constructor issuance.'],
 minimumConfirmations:12,fundsVerified:false,providerDepositsEnabled:false
});
export function walletExecutionAuthorized(policy=WALLET_EXECUTION_POLICY){
 const base=WALLET_EXECUTION_POLICY;
 return policy?.schema===base.schema&&policy.status==='APPROVED_FOR_OWNER_WALLET'&&policy.submissionAllowed===true&&policy.issuerPolicySigned===true&&policy.ownerApproved===true&&policy.reviewEvidenceVerified===true
  &&['requestSha256','artifactSha256','issuerPolicySha256','creationSha256','chainId','genesisHash','sender','decimals','initialSupplyNusd','initialSupplyBaseUnits'].every(key=>policy[key]===base[key])
  &&Array.isArray(policy.reviews)&&policy.reviews.length===base.reviews.length&&base.reviews.every(({id})=>policy.reviews.filter(r=>r?.id===id&&r.verified===true&&typeof r.evidenceSha256==='string'&&/^[a-f0-9]{64}$/.test(r.evidenceSha256)).length===1)
  &&policy.minimumConfirmations>=12&&Number.isSafeInteger(policy.minimumConfirmations);
}
