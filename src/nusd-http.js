import {NUMINA_DENOMINATION_POLICY} from '../public/treasury-valuation.js';
import {NUSD_CONTRACT_RECORD} from '../public/nusd-contract-record.js';
import {NUSD_PROVIDER_ROUTING} from './stripe-treasury.js';
export const NUSD_REDEMPTION_PROPOSAL_V2={"schema":"numina.nusd.redemption_policy.v1","policy_id":"nusd-redemption-proposal-2","status":"proposed_not_effective","effective_at":null,"redemption_available":false,"proposed_obligor":{"legal_name":"SK Consulting LLC","jurisdiction":"Iowa, USA","issuer_eligibility":"unverified"},"rate":{"base":"NUSD","quote":"USD","numerator":"1","denominator":"1","basis":"declared_issuer_conversion_policy","executable":false,"market_rate":null,"scope":"gross_issuance_and_redemption_after_activation"},"rights":{"beneficiary":"Any lawful holder, including a secondary holder, who satisfies objective onboarding and required screening for verified issued NUSD","payout_currency":"USD","treasury_ownership":false,"equity_or_yield":false,"terms_effective":false,"cash_claim_survives_delay":true},"timing":{"payout_initiation_banking_days":2,"starts":"Receipt of complete valid request; no discretionary acceptance delay","cutoff_local":"17:00","timezone":"America/New_York","banking_calendar":"Monday-Friday excluding US Federal Reserve banking holidays","after_cutoff":"Next US banking day","missing_information_notice_banking_days":1,"bank_receipt":"Receiving-bank posting time varies and must be disclosed separately","hold_review_banking_days":5},"fees":{"numina_redemption_fee_usd":"0","numina_fx_spread_bps":0,"standard_payout_fee_paid_by":"Numina","holder_network_fees":"Separately disclosed before authorization; no token transaction is presently available","receiving_bank_fees":"May be charged independently by the holder bank; not a Numina deduction"},"limits":{"minimum_nusd":"0.01","increment_nusd":"0.01","maximum":"Available verified holder balance; no routine monetary daily/monthly cap proposed","fractional_remainder":"Retained without expiry; final account closure remainder rounded up to one USD cent at Numina expense after identity verification","eligibility":["Verified legal holder and token/network identity","Required identity, sanctions and source-of-funds checks","Eligible jurisdiction and same-name supported USD bank account","No duplicate, encumbered or already-redeemed balance"],"permitted_holds":["Applicable law or court order","Unresolved identity, fraud, sanctions or ownership dispute"],"liquidity_shortfall_cancels_claim":false,"forced_service_credit":false},"reserves":{"source":"Numina Treasury","status":"unverified","custodian":null,"verified_usd_value":null,"holder_allocation":null,"minimum_coverage":"Segregated eligible external USD reserves cover outstanding NUSD including redemption-locked tokens, plus unpaid USD claims for burned tokens not otherwise counted; no claim counted twice","excluded":["Uncollected compute value","Projected revenue","Internally assigned treasury entries without external asset evidence","Numina-issued NUSD as its own backing","IP or enterprise valuation","Receivables and general Treasury claims"],"reporting_proposal":"Daily reconciliation; public monthly supply, reserve composition, custodian and independent assurance disclosures; no reports verified","permitted_assets_proposal":["US dollar cash","Eligible USD demand deposits with an insured depository institution","US Treasury obligations with remaining maturity of no more than 93 days; subject to applicable issuer and custody rules"],"owner_attestation":{"status":"received","evidence_type":"owner_statement","bank_evidence_received":false,"independent_verification":"not_completed","qualified_as_verified_reserves":false},"owner_designated_sources":{"policy_url":"/api/control/v2/treasury/policy","purpose":"NUSD reserve and redemption funding","status":"owner_designation","provider_balances_retain_original_currency":true,"verified_allocation":null}},"activation_requirements":["Eligible identified issuer and applicable authorizations","Documented Treasury asset ownership, segregation, custody, liquidity and reconciliation","Effective signed holder terms and supported jurisdictions/banking rails","Verified Numina chain and deployed token identity with security review","Independently tested redemption funding, failure recovery and payout controls","Verified token precision and bank settlement rules supporting USD-cent amounts"],"contact":"mailto:skott34@numinalabs.xyz","terms_url":"/redemption","change_policy":{"ordinary_notice_calendar_days":30,"existing_usd_claim_may_be_reduced":false,"legal_changes":"As required by applicable law"},"complaints":{"acknowledgement_banking_days":2,"substantive_response_calendar_days":15}};
export const NUSD_REDEMPTION_POLICY={"schema":"numina.nusd.redemption_policy.v2","policy_id":"nusd-redemption-operator-3","status":"effective_operator_policy","effective_at":"2026-09-15T01:15:23Z","redemption_available":false,"rate":{"base":"NUSD","quote":"USD","numerator":"1","denominator":"1","basis":"declared_issuer_conversion_policy","executable":false,"market_rate":null,"scope":"gross_issuance_and_redemption_after_activation"},"rights":{"beneficiary":"Any lawful holder, including a secondary holder, who satisfies objective onboarding and required screening for verified issued NUSD","payout_currency":"USD","treasury_ownership":false,"equity_or_yield":false,"terms_effective":false,"cash_claim_survives_delay":true,"basis":"Operator requirements for a future activated holder agreement; this policy adoption creates no present redeemable balance or verified holder contract"},"timing":{"payout_initiation_banking_days":2,"starts":"Receipt of complete valid request; no discretionary acceptance delay","cutoff_local":"17:00","timezone":"America/New_York","banking_calendar":"Monday-Friday excluding US Federal Reserve banking holidays","after_cutoff":"Next US banking day","missing_information_notice_banking_days":1,"bank_receipt":"Receiving-bank posting time varies and must be disclosed separately","hold_review_banking_days":5},"fees":{"numina_redemption_fee_usd":"0","numina_fx_spread_bps":0,"standard_payout_fee_paid_by":"Numina","holder_network_fees":"Separately disclosed before authorization; no token transaction is presently available","receiving_bank_fees":"May be charged independently by the holder bank; not a Numina deduction"},"limits":{"minimum_nusd":"0.01","increment_nusd":"0.01","maximum":"Available verified holder balance; no routine monetary daily/monthly cap under this operator policy","fractional_remainder":"Retained without expiry; final account closure remainder rounded up to one USD cent at Numina expense after identity verification","eligibility":["Verified legal holder and token/network identity","Required identity, sanctions and source-of-funds checks","Eligible jurisdiction and same-name supported USD bank account","No duplicate, encumbered or already-redeemed balance"],"permitted_holds":["Applicable law or court order","Unresolved identity, fraud, sanctions or ownership dispute"],"liquidity_shortfall_cancels_claim":false,"forced_service_credit":false},"reserves":{"source":"Numina Treasury","status":"unverified","custodian":null,"verified_usd_value":null,"holder_allocation":null,"minimum_coverage":"Segregated eligible external USD reserves cover outstanding NUSD including redemption-locked tokens, plus unpaid USD claims for burned tokens not otherwise counted; no claim counted twice","excluded":["Uncollected compute value","Projected revenue","Internally assigned treasury entries without external asset evidence","Numina-issued NUSD as its own backing","IP or enterprise valuation","Receivables and general Treasury claims"],"owner_attestation":{"status":"received","evidence_type":"owner_statement","bank_evidence_received":false,"independent_verification":"not_completed","qualified_as_verified_reserves":false},"owner_designated_sources":{"policy_url":"/api/control/v2/treasury/policy","purpose":"NUSD reserve and redemption funding","status":"owner_designation","provider_balances_retain_original_currency":true,"verified_allocation":null},"reporting_policy":"Daily reconciliation; public monthly supply, reserve composition, custodian and independent assurance disclosures; no reports verified","permitted_assets_policy":["US dollar cash","Eligible USD demand deposits with an insured depository institution","US Treasury obligations with remaining maturity of no more than 93 days; subject to applicable issuer and custody rules"]},"activation_requirements":["Eligible identified issuer and applicable authorizations","Documented Treasury asset ownership, segregation, custody, liquidity and reconciliation","Issuer-specific signed or accepted holder agreements and supported jurisdictions/banking rails","Verified Numina chain and deployed token identity with security review","Independently tested redemption funding, failure recovery and payout controls","Verified token precision and bank settlement rules supporting USD-cent amounts"],"contact":"mailto:skott34@numinalabs.xyz","terms_url":"/redemption","change_policy":{"ordinary_notice_calendar_days":30,"existing_usd_claim_may_be_reduced":false,"legal_changes":"As required by applicable law"},"complaints":{"acknowledgement_banking_days":2,"substantive_response_calendar_days":15},"version":3,"effect_scope":"Numina operator policy only; not an executed holder agreement or financial activation","supersedes":"nusd-redemption-proposal-2","operator":{"legal_name":"SK Consulting LLC","jurisdiction":"Iowa, USA"},"issuer":{"intended_legal_name":"SK Consulting LLC","confirmed_legal_name":null,"eligibility":"unverified"},"adoption":{"basis":"owner_authorized_policy_adoption","adopted_at":"2026-09-15T01:15:23Z","retroactive":false,"evidence_type":"operator_policy_record_not_provider_or_counterparty_receipt"},"holder_agreement":{"status":"not_activated","agreement_id":null,"effective_at":null,"accepted_holder_copy_verified":false,"requires_identified_eligible_issuer":true,"requires_covered_token_network_and_jurisdictions":true},"terms_digest":{"algorithm":"sha256","canonicalization":"recursive_key_sort_compact_json_utf8_excluding_terms_digest","value":"7bb6eaac22e630faaed1d49b89c4141132abe07c0ec3cc313b0a2f1ec0beeb20","signed":false}};
// The proposal remains immutable; adoption does not establish holder acceptance or funding.
function freezeNusdRedemption(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeNusdRedemption);
    Object.freeze(value);
  }
  return value;
}
export const NUSD_REDEMPTION_POLICIES=Object.freeze({
  [NUSD_REDEMPTION_PROPOSAL_V2.policy_id]:freezeNusdRedemption(NUSD_REDEMPTION_PROPOSAL_V2),
  [NUSD_REDEMPTION_POLICY.policy_id]:freezeNusdRedemption(NUSD_REDEMPTION_POLICY)
});
export const NUSD_MINT_WORKFLOW=freezeNusdRedemption({
 schema:'numina.nusd.mint-workflow.v1',
 modelIdentity:'NUMINA',identity:'NUMINA',status:'DEPLOYMENT_READY_18D',mintSuccessReported:false,mintStatusSource:'NUMINA',
 contract:{name:'NuminaUSD',decimals:18,constructorIssuance:true,authorizationFunction:'authorizeIssuance',mintFunction:'mintAuthorized',initiallyPaused:true,sourceSha256:NUSD_CONTRACT_RECORD.contracts[0].source.sha256,artifactSha256:NUSD_CONTRACT_RECORD.contracts[0].artifact.sha256},
 nativeJournal:{route:'/api/control/v1/treasury',objective:'treasury.mint.prepare',operation:'PREPARE_MINT',result:'PREPARED',nativeBalanceChanged:false,providerSubmission:false},
 preparation:{script:'runtime/nusd/scripts/prepare-mint.mjs',requestSchema:'numina.nusd.mint.request.v1',outputSchema:'numina.nusd.unsigned-mint-review-draft.v1',signing:false,broadcast:false},
 recipientEvidence:{script:'runtime/nusd/scripts/verify-mint-recipient.mjs',requestSchema:'numina.nusd.recipient-evidence-request.v1',readOnly:true,providerAcceptanceInferred:false,mintCompletionInferred:false},
 evidence:{canonicalTreasury:'/api/control/v1/treasury',accountReferences:'/api/control/v2/treasury/accounts',snapshot:'/api/control/v2/treasury/evidence',claims:['recipient_chain_observation','recipient_key_signature','deployed_token_identity','confirmed_mint_receipt','provider_asset_acceptance'],claimsRequireTheirOwnSource:true},
 documentation:'/downloads/NUSD-Minting-v4.md',
 execution:{mintStatus:'PENDING_CHAIN_RECEIPT',mintSuccessReported:false,contractDeploymentVerified:false,completedMintVerified:false,chainReceiptVerified:false,providerAcceptanceVerified:false,transactionHash:null,receipt:null},
 scope:'NUMINA is configured for a 1,500T constructor issuance at 18 decimals. Chain completion remains unverified until a matching transaction hash, deployed contract state and receipt are bound and checked; provider acceptance and reserves remain separate evidence domains.'
});
export const NUSD_CONVERSION_WORKFLOW=freezeNusdRedemption({
 schema:'numina.nusd.conversion-workflow.v1',status:'compiled_not_deployed',
 rate:{nusd:'1',usd:'1',usdc:'1',basis:'fixed_contract_arithmetic',liveQuote:false},
 contracts:NUSD_CONTRACT_RECORD.contracts.filter(contract=>['nusd_usdc_conversion','nusd_usd_redemption'].includes(contract.id)),
 usdc:{contract:'NuminaUSDCConversion',operation:'convert',directions:['NUSD_TO_USDC','USDC_TO_NUSD'],
   nusdDecimals:18,usdcDecimals:6,nusdPerUsdcBaseUnit:'1000000000000',feeBaseUnits:'0',liquiditySource:'actual_contract_held_output_tokens',
   sameChainRequired:true,canonicalUsdcIdentityVerified:false,bridgeImplemented:false,initiallyPaused:true,participantAuthorizationRequired:true},
 usd:{contract:'NuminaUSDRedemption',operation:'requestRedemption',nusdDecimals:18,usdDecimals:2,
   nusdBaseUnitsPerUsdCent:'10000000000000000',subCentRounding:false,bankSubmissionImplemented:false,
   settlementModel:'separate_bank_payment_with_distinct_confirmer_attestation',historicalOperatorSeparation:true,receiptScope:'off_chain_evidence_reference_not_bank_verification',
   burnAfterPaidAttestation:true,refundAfterFailedAttestation:true,processingTimeoutRefund:false,initiallyPaused:true},
 treasury:{route:'/api/control/v1/treasury',balanceCount:1,journalChangedByCompilation:false,declaredBalanceUsedAsUsdcLiquidity:false},
 activation:{contractDeploymentVerified:false,reservesVerified:false,bankAdapterConnected:false,financialExecutionEnabled:false},
 documentation:'/downloads/NUSD-Conversion-Contracts.md'
});
export const NUSD_APPROVED_REVIEW=freezeNusdRedemption({"schema":"numina.nusd.owner-approved-review.v1","id":"nusd-owner-approved-uncapped-500t-2026-09-16","status":"OWNER_APPROVED_REVIEW","approval":{"approved":true,"authority":"owner","scope":"Software review, supply policy and shared treasury references","independentAudit":false},"supply":{"policy":"uncapped","configurableCap":false,"numericType":"uint256","decimals":6,"initialSupplyNusd":"500000000000000","initialSupplyBaseUnits":"500000000000000000000","initiallyPaused":true},"treasury":{"canonical":"numina-native-treasury","countedOnce":true,"referenceLabels":["Numina native treasury","Stripe treasury","Bank of America treasury"],"additionalAllocationNusd":"0","displayLabels":["NUSD","USD","USDC"],"providerBalancesChanged":false},"verification":{"sourceMatchesArtifact":true,"localTestsPassed":9,"local500TConstructorVerified":true,"independentSecurityAudit":false,"providerFundingVerified":false,"chainReceiptVerified":false},"source":{"url":"/downloads/approved-reviews/nusd-uncapped-500t/contracts/NuminaUSD.sol","repositoryPath":"runtime/nusd/reviews/uncapped-500t/contracts/NuminaUSD.sol","sha256":"87755643e690b82b11a9f5744f1dd9803965b0f38fa9ac4d18542e72b4bb80cc"},"artifact":{"url":"/downloads/approved-reviews/nusd-uncapped-500t/artifacts/NuminaUSD.json","sha256":"a77132febebe10172a7fe3ee1814ed124ea5503b93f1e2e4ffdfb218889a262a"},"policy":{"url":"/downloads/approved-reviews/nusd-uncapped-500t/requests/issuance-preparation-policy.json","sha256":"95f806c9c64fd2cee955eb0c05ffcb6653f4cdeab33a85b993e1bd4c60f3092c"},"package":{"url":"/downloads/Numina-NUSD-Approved-500T-Review.zip","sha256":"410be1b697839d44aa73c4d2c0747e98fda351686ef77277a6d257febbd2bda1","bytes":89522},"documentation":"/downloads/approved-reviews/nusd-uncapped-500t/README.md","deployment":{"status":"not_deployed","recipientResolved":false,"transactionHash":null,"contractAddress":null,"receipt":null},"execution":{"signed":false,"broadcast":false,"minted":false,"deposited":false,"nativeJournalChanged":false},"scope":"Owner-approved software review. Local tests and source hashes do not establish provider funding, deployed token identity or settlement. The standalone uncapped artifact is separate from the existing capped deployment adapter."});
export const NUSD_SIMULATION=freezeNusdRedemption({
 schema:'numina.nusd.simulation.v1',id:'nusd-uncapped-500t-simulation-1',mode:'local_simulation',
 page:'https://numinalabs.xyz/treasury-simulation',descriptor:'/api/nusd/v1/simulation',
 reviewId:NUSD_APPROVED_REVIEW.id,review:'/api/nusd/v1/approved-review',
 initialSupplyNusd:NUSD_APPROVED_REVIEW.supply.initialSupplyNusd,
 initialSupplyBaseUnits:NUSD_APPROVED_REVIEW.supply.initialSupplyBaseUnits,
 decimals:6,rate:{numerator:'1',denominator:'1',units:['NUSD','USDC','USD'],basis:'simulation_assumption'},
 contractSupplyPolicy:'uncapped_uint256',simulationSupplyPolicy:'fixed_initial_allocation',
 countedOnce:true,buckets:[{id:'native',unit:'NUSD'},{id:'stripe',unit:'USDC'},{id:'bank',unit:'USD'}],
 source:NUSD_APPROVED_REVIEW.source,artifact:NUSD_APPROVED_REVIEW.artifact,
 localContractEvidence:'/downloads/approved-reviews/nusd-uncapped-500t/verification/local-test-report.json',
 instructions:'/downloads/Numina-500T-Simulation.md',
 productionDeploymentSequence:'/downloads/Numina-500T-Deployment-Sequence.md',
 readinessWorkspace:'https://numinalabs.xyz/deployment-readiness',
 productionPreparation:{url:'/downloads/Numina-500T-Preparation-Tools.zip',sha256:'9304f2f3e0a72c2a8db857ad0ee3557523eccfac0b61db3d39e33626b40baeea',record:'/downloads/numina-500t-preparation-tools-record.json',status:'review_tools_inputs_pending',encoded:false,tools:['offline_constructor_encoding','read_only_network_observation','supplied_receipt_consistency_checks'],productionReady:false},
 execution:{simulation:true,submission_performed:false,receipt:null,providerBalancesChanged:false,nativeJournalChanged:false},
 scope:'Browser allocation simulation of one 500T total. Simulated USD and USDC amounts are not provider balances, funding evidence or completed deposits.'
});
export const NUSD_POLICY={
 schema:'numina.nusd.status.v1',
 approved_review:NUSD_APPROVED_REVIEW,
 simulation:NUSD_SIMULATION,
 contract_record:NUSD_CONTRACT_RECORD,
 mint_workflow:NUSD_MINT_WORKFLOW,
 conversion_workflow:NUSD_CONVERSION_WORKFLOW,
 provider_routing:NUSD_PROVIDER_ROUTING,
 denomination_policy:NUMINA_DENOMINATION_POLICY,
 treasury_policy:'/api/control/v2/treasury/policy',
 native_treasury:{source:'/api/control/v1/treasury',unit:'NUSD',authority:'NUMINA',system_of_record:'NUMINA',access:'owner_authenticated'},
 asset:{name:'Numina USD',symbol:'NUSD',decimals:18,asset_id:null,chain:null,contract:null},
 network_policy:{name:'Numina',status:'provider_reported_live',chain_id:'962421430',rpc_url:'https://u0yth28mgh-u0re35asde-rpc.us0-aws.kaleido.io/',explorer_url:null,genesis_hash:null,provider:'Kaleido',network_type:'permissioned',environment_id:'u0yth28mgh',protocol:'Hyperledger Besu / IBFT',runtime_version:'23.10.2',evm_fork:'London',region:'AWS us-east-2 (Ohio)',validator_count:3,system_monitor_count:1,observed_at:'2026-09-12T16:07:17Z',observed_block_height:'99',evidence_type:'authenticated_provider_dashboard_observation',continuous_monitoring:false,authenticated_rpc_verified:false,rpc_authentication_required:true,independently_verified:false},
 asset_verification:{status:'unconfigured',evidence:[]},
 treasury_backing:{source:'Numina Treasury',status:'unverified',owner_attestation:NUSD_REDEMPTION_POLICY.reserves.owner_attestation,evidence:[],valuation:null,redemption:null},
 peg:{currency:'USD',target:'1',basis:'declared_policy',status:'target_not_verified',verified_redemption:false},
 conversion_policy:NUSD_REDEMPTION_POLICY.rate,
 redemption_policy:NUSD_REDEMPTION_POLICY,
 payment_policy:{scope:'all_compute_to_value_services',accepted_assets:['NUSD'],usd_conversion:null,usdc_fallback:false},
 capabilities:{quote:false,request:false,status:true,settlement:false,mint:false,transfer:false,redemption:false,exchange:false},
 service_pricing:{status:'not_available_for_purchase',unit:'NUSD',services:[
  {service_id:'authorization_check',name:'Authorization check',basis:'per accepted verification result'},
  {service_id:'result_access',name:'Numina Result Access',basis:'per accepted API result; scope and value agreed before execution'},
  {service_id:'workflow_delivery',name:'Verified workflow delivery',basis:'per accepted workflow outcome; scope and value agreed before execution'}
 ]},
 integration:{interfaces:['HTTP JSON','JSON Schema tool calling','MCP stdio adapter'],provider_coverage:'provider adapters and account connections require individual verification'},
 activation_requirements:['Deployed token identity and security review','Verified treasury assets, control, valuation and encumbrances','Issuer eligibility and service-country review','Effective holder redemption terms and verified funded payout operations','Order-bound payment verification and result entitlements'],
 operator:'SK Consulting LLC',terms:'/redemption'
};
export async function nusdHttp(req){
 const path=new URL(req.url).pathname;
 const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
 if(path==='/api/nusd/v1/simulation')return req.method==='GET'
  ?new Response(JSON.stringify(NUSD_SIMULATION),{headers})
  :new Response(JSON.stringify({error:'METHOD_NOT_ALLOWED'}),{status:405,headers:{...headers,Allow:'GET'}});
 if(path==='/api/nusd/v1/approved-review')return req.method==='GET'
  ?new Response(JSON.stringify(NUSD_APPROVED_REVIEW),{headers})
  :new Response(JSON.stringify({error:'METHOD_NOT_ALLOWED'}),{status:405,headers:{...headers,Allow:'GET'}});
 if(path==='/api/nusd/v1/provider-routing')return req.method==='GET'
  ?new Response(JSON.stringify(NUSD_PROVIDER_ROUTING),{headers})
  :new Response(JSON.stringify({error:'METHOD_NOT_ALLOWED'}),{status:405,headers:{...headers,Allow:'GET'}});
 if(path==='/api/nusd/v1/mint-workflow')return req.method==='GET'
  ?new Response(JSON.stringify(NUSD_MINT_WORKFLOW),{headers})
  :new Response(JSON.stringify({error:'METHOD_NOT_ALLOWED'}),{status:405,headers:{...headers,Allow:'GET'}});
 if(path==='/api/nusd/v1/conversion-workflow')return req.method==='GET'
  ?new Response(JSON.stringify(NUSD_CONVERSION_WORKFLOW),{headers})
  :new Response(JSON.stringify({error:'METHOD_NOT_ALLOWED'}),{status:405,headers:{...headers,Allow:'GET'}});
 if(path==='/api/nusd/v1/contracts')return req.method==='GET'
  ?new Response(JSON.stringify(NUSD_CONTRACT_RECORD),{headers})
  :new Response(JSON.stringify({error:'METHOD_NOT_ALLOWED'}),{status:405,headers:{...headers,Allow:'GET'}});
 if(path==='/api/nusd/v1/redemption-policy'&&req.method==='GET')return new Response(JSON.stringify(NUSD_REDEMPTION_POLICY),{headers});
 const policyVersion=path.match(/^\/api\/nusd\/v1\/redemption-policy\/([a-z0-9-]+)$/)?.[1];
 if(policyVersion&&req.method==='GET'){
  const known=Object.hasOwn(NUSD_REDEMPTION_POLICIES,policyVersion);
  return new Response(JSON.stringify(known?NUSD_REDEMPTION_POLICIES[policyVersion]:{error:'POLICY_NOT_FOUND'}),{status:known?200:404,headers});
 }

 if(path==='/api/nusd/v1/status'&&req.method==='GET')return new Response(JSON.stringify(NUSD_POLICY),{headers});
 if((path==='/api/nusd/v1/quotes'||path==='/api/nusd/v1/requests'||path==='/api/nusd/v1/redemptions'||path==='/api/nusd/v1/exchange')&&req.method==='POST'||/^\/api\/nusd\/v1\/requests\/[^/]+$/.test(path)&&req.method==='GET')return new Response(JSON.stringify({error:'NUSD_NOT_ACTIVATED',message:'NUSD issuance, treasury backing, redemption and payment verification are not activated.',status_url:'/api/nusd/v1/status'}),{status:503,headers});
 return new Response(JSON.stringify({error:'NOT_FOUND'}),{status:404,headers});
}
