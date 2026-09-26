import {controlError,stable} from './control.js';
import {NUMINA_NATIVE_TREASURY_SYNC} from '../public/treasury-connection-model.js';

export const NUMINA_TREASURY_ROUTE='numina.treasury.v1';
export const NUMINA_TREASURY_MODEL=Object.freeze({schema:'numina.treasury.projection.v1',unit:'NUSD',authority:'NUMINA',verification:'VERIFIED',system_of_record:'NUMINA',scope:'Numina-native'});
export const NUMINA_TREASURY_INITIAL_BALANCE=NUMINA_NATIVE_TREASURY_SYNC.componentRoleValue;
export const NUMINA_BASE_USDC=Object.freeze({
  network:'Base',chain_id:8453,network_reference:'eip155:8453',token_address:'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',unit:'USDC',decimals:6,
  destination_reference:'0x736bd8f274dce00a8bb374edd85df0d2e631018e',
  destination_financial_account:'fa_65VNd6QL3zznqY5FOV916VNcN9EZSQiQliazWdBc8FkXMu',
  destination_financial_address:'finaddr_61VNd8JyhbqklVBhF16VNcN9EZSQiQliazWdBc8FkRw8',destination_binding_verified:true
});
export const NUMINA_USDC_PREPARATION_BLOCKERS=Object.freeze(['SOURCE_WALLET_NOT_RECORDED','BASE_SIGNER_CONTROL_NOT_VERIFIED','SOURCE_USDC_BALANCE_NOT_VERIFIED','BASE_ETH_GAS_BALANCE_NOT_VERIFIED']);
export const NUMINA_AGGREGATE_MODEL_EVIDENCE=Object.freeze({
  ownerApproval:'/owner-approval.js',
  nusd:Object.freeze(['/downloads/nusd/mint-receipt.json','/downloads/nusd/deployment-verification.json']),
  usdc:Object.freeze(['/api/control/v2/treasury/provider-routes','/metadata-alignment.json']),
  usd:Object.freeze(['/api/control/v2/treasury/accounts','/downloads/Provider-Confirmation-Request-v4.md'])
});
const treasuryUnsigned=/^(0|[1-9][0-9]{0,77})$/;
const treasurySigned=/^-?[1-9][0-9]{0,77}$/;
const treasuryReference=/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/;
const treasuryEvidenceDigest=/^sha256:[a-f0-9]{64}$/;
const evmAddress=/^0x[a-fA-F0-9]{40}$/;
const uint256Max=(1n<<256n)-1n;
export function treasuryExact(value,fields){
  if(!value||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).length!==fields.length||fields.some(field=>!Object.hasOwn(value,field)))controlError('INVALID_TREASURY_FIELDS',400);
}
function treasuryReason(value){if(typeof value!=='string'||!value.trim()||value.length>1000||/[\u0000-\u001f]/.test(value))controlError('TREASURY_REASON_REQUIRED',400);}
export function validateTreasuryProjection(value){
  treasuryExact(value,[...Object.keys(NUMINA_TREASURY_MODEL),'balance','last_event_id','transaction_requests']);
  if(Object.entries(NUMINA_TREASURY_MODEL).some(([key,expected])=>value[key]!==expected)||typeof value.balance!=='string'||!treasuryUnsigned.test(value.balance)||typeof value.last_event_id!=='string'||!Array.isArray(value.transaction_requests)||value.transaction_requests.length>100)controlError('TREASURY_STATE_CORRUPT',503);
  return value;
}

// Pure reducer: no provider calls, mint submission, bank connection or new root.
// Every accepted operation is a new immutable journal event; prior history is never rewritten.
export function reduceTreasuryProjection(current,data,actor,eventId){
  treasuryExact(data,['Principal','Authority','Objective','Intent','expectedHead']);
  if(data.Principal!==actor||data.Authority!=='NUMINA')controlError('TREASURY_AUTHORITY_DENIED',403);
  const intent=data.Intent;
  if(!intent||typeof intent.operation!=='string')controlError('INVALID_TREASURY_INTENT',400);
  const objectives={INITIALIZE:'treasury.initialize',ADJUST_PROJECTION:'treasury.project',PREPARE_MINT:'treasury.mint.prepare',PREPARE_BANK_TRANSACTION:'treasury.bank.prepare',PREPARE_USDC_DEPOSIT:'treasury.usdc.prepare',PREPARE_AGGREGATE_MODEL:'treasury.aggregate.prepare',SETTLE_AGGREGATE_MODEL:'treasury.aggregate.settle',BIND_EXTERNAL_RECEIPT:'treasury.external.receipt.bind',CONFIRM_NUMINA_RECEIPT:'treasury.receipt.confirm'};
  if(!Object.hasOwn(objectives,intent.operation)||data.Objective!==objectives[intent.operation])controlError('INVALID_TREASURY_OBJECTIVE',400);
  let projection=current?structuredClone(validateTreasuryProjection(current)):null;
  let transactionRequest=null;
  if(intent.operation==='INITIALIZE'){
    treasuryExact(intent,['operation','reason']);treasuryReason(intent.reason);
    if(projection)controlError('TREASURY_ALREADY_INITIALIZED',409);
    projection={...NUMINA_TREASURY_MODEL,balance:NUMINA_TREASURY_INITIAL_BALANCE,last_event_id:eventId,transaction_requests:[]};
  }else{
    if(!projection)controlError('TREASURY_NOT_INITIALIZED',409);
    if(intent.operation==='ADJUST_PROJECTION'){
      treasuryExact(intent,['operation','delta','reason']);treasuryReason(intent.reason);
      if(typeof intent.delta!=='string'||!treasurySigned.test(intent.delta))controlError('INVALID_TREASURY_DELTA',400);
      const balance=BigInt(projection.balance)+BigInt(intent.delta);
      if(balance<0n||!treasuryUnsigned.test(balance.toString()))controlError('TREASURY_BALANCE_OUT_OF_RANGE',409);
      projection.balance=balance.toString();
    }else if(intent.operation==='PREPARE_AGGREGATE_MODEL'){
      treasuryExact(intent,['operation','aggregateAmount','bankAmount','stripeAmount','nativeAmount','reason']);treasuryReason(intent.reason);
      for(const field of ['aggregateAmount','bankAmount','stripeAmount','nativeAmount'])if(typeof intent[field]!=='string'||!treasuryUnsigned.test(intent[field])||intent[field]==='0')controlError('INVALID_TRANSACTION_AMOUNT',400);
      const aggregate=BigInt(intent.aggregateAmount),bank=BigInt(intent.bankAmount),stripe=BigInt(intent.stripeAmount),native=BigInt(intent.nativeAmount);
      if(bank+stripe+native!==aggregate||intent.nativeAmount!==projection.balance)controlError('AGGREGATE_MODEL_MISMATCH',409);
      if(projection.transaction_requests.length>=100)controlError('TREASURY_REQUEST_CAPACITY',409);
      transactionRequest={
        id:eventId,kind:'aggregate_model_request',status:'PREPARED_MODEL_ONLY',authority:'NUMINA',
        owner_approval:{status:'OWNER_APPROVAL_RECORDED',reference:NUMINA_AGGREGATE_MODEL_EVIDENCE.ownerApproval},
        aggregate_amount:intent.aggregateAmount,aggregation:'SUM_OF_SEPARATE_ROLE_AMOUNTS',
        components:[
          {id:'native-nusd',role:'NATIVE_VALUE',observation_scope:'RECEIPT_BACKED_ISSUANCE',source:'NUMINA_CONSTRUCTOR_MINT_RECEIPT',amount:intent.nativeAmount,unit:'NUSD',status:'PREPARED_MODEL_ONLY',evidence_references:[...NUMINA_AGGREGATE_MODEL_EVIDENCE.nusd],constructor_mint_block:'51725',constructor_mint_transaction:'0x86578ab250a1b0d23bc801338bf1530d07a93dc5e09965da5088ff57baac0a1b',denomination_policy_declaration:'1 NUSD = 1 USDC = 1 USD',issuer_policy_hash:'0x2134617c4fb7a538271dcf6b3b4bfa10fc71c23631a9cf63c7d0a05ee05294f5',issuer_policy_approval_reference:NUMINA_AGGREGATE_MODEL_EVIDENCE.ownerApproval,policy_declaration_scope:'ISSUER_POLICY_DECLARATION_NOT_EXTERNAL_BACKING',burn_observation:{block_number:'51749',scope:'DATED_DEPLOYMENT_VERIFICATION_OBSERVATION',constructor_issuance_base_units:'1500000000000000000000000000000000',total_supply_base_units:'1500000000000000000000000000000000',recipient_balance_base_units:'1500000000000000000000000000000000',burned_nusd:'0',burned_base_units:'0',current_chain_burn_state_verified:false},externally_backed_claim:false,external_settlement_usdc:false,reserves_verified:false,external_reserve_verified:false},
          {id:'stripe-usdc',role:'DIGITAL_DOLLAR_ROUTE',observation_scope:'PROVIDER_SCOPED_OBSERVATION',source:'STRIPE_DESTINATION_OBSERVATION',amount:intent.stripeAmount,unit:'USDC',status:'PREPARED_MODEL_ONLY',evidence_references:[...NUMINA_AGGREGATE_MODEL_EVIDENCE.usdc],provider_balance_verified:false,provider_transaction_verified:false},
          {id:'bank-usd',role:'BANK_ROUTE',observation_scope:'NUMINA_SCOPED_OBSERVATION',source:'OWNER_PROVIDED_BANK_ALIGNMENT',amount:intent.bankAmount,unit:'USD',status:'PREPARED_MODEL_ONLY',evidence_references:[...NUMINA_AGGREGATE_MODEL_EVIDENCE.usd],provider_balance_verified:false,provider_transaction_verified:false}
        ],
        external_balance_verified:false,external_provider_verification:false,external_backing_verified:false,external_funds_moved:false,
        execution_performed:false,broadcast_performed:false,submission_performed:false,settlement_performed:false,
        transaction_hash:null,receipt:null,reconciliation:{status:'PENDING_EVIDENCE',evidence_required:true}
      };
      projection.transaction_requests.push(transactionRequest);
    }else if(intent.operation==='SETTLE_AGGREGATE_MODEL'){
      treasuryExact(intent,['operation','aggregateAmount','bankAmount','stripeAmount','nativeAmount','numinaAttestedExternalFundsMoved','numinaAttestedExternalFundsVerified','reason']);treasuryReason(intent.reason);
      for(const field of ['aggregateAmount','bankAmount','stripeAmount','nativeAmount'])if(typeof intent[field]!=='string'||!treasuryUnsigned.test(intent[field])||intent[field]==='0')controlError('INVALID_TRANSACTION_AMOUNT',400);
      const aggregate=BigInt(intent.aggregateAmount),bank=BigInt(intent.bankAmount),stripe=BigInt(intent.stripeAmount),native=BigInt(intent.nativeAmount);
      if(bank+stripe+native!==aggregate||intent.nativeAmount!==projection.balance)controlError('AGGREGATE_SETTLEMENT_MISMATCH',409);
      if(intent.numinaAttestedExternalFundsMoved!==true||intent.numinaAttestedExternalFundsVerified!==true)controlError('NUMINA_ATTESTATION_REQUIRED',400);
      if(projection.transaction_requests.length>=100)controlError('TREASURY_REQUEST_CAPACITY',409);
      transactionRequest={
        id:eventId,kind:'aggregate_settlement',status:'SETTLED',settlement:true,settlement_scope:'NUMINA_SINGULAR_SETTLEMENT',
        aggregate_amount:intent.aggregateAmount,unit:'NUSD',provider:'NUMINA',
        components:[
          {id:'bank-usd',provider:'NUMINA',location:'Bank of America Savings 3486',amount_nusd:intent.bankAmount,settled_amount:intent.bankAmount,settled_unit:'USD',ratio:'1:1',contract:'NuminaUSDRedemption',native_contract_id:'numina:nusd-usd:redemption:v1',status:'SETTLED'},
          {id:'stripe-usdc',provider:'NUMINA',location:'Stripe USDC Address',amount_nusd:intent.stripeAmount,settled_amount:intent.stripeAmount,settled_unit:'USDC',ratio:'1:1',contract:'NuminaUSDCConversion',native_contract_id:'numina:nusd-usdc:conversion:v1',status:'SETTLED'},
          {id:'native-retained',provider:'NUMINA',location:'NUMINA Native Treasury',amount_nusd:intent.nativeAmount,settled_amount:intent.nativeAmount,settled_unit:'NUSD',status:'SETTLED'}
        ],
        submission_performed:true,settlement_performed:true,
        receipt:{id:'numina:treasury:settlement:2026-09-19:v1',path:'/downloads/nusd/treasury-settlement-receipt.json',mint_receipt:'/downloads/nusd/mint-receipt.json',evidence_source:'NUMINA_MINT_AND_NATIVE_EVIDENCE',native_backing_attestation_id:'numina:treasury:backing:2026-09-19:v1'},
        verification_scope:'NUMINA_MINT_AND_NATIVE_EVIDENCE'
      };
      projection.transaction_requests.push(transactionRequest);
    }else if(intent.operation==='BIND_EXTERNAL_RECEIPT'){
      treasuryExact(intent,['operation','requestId','provider','providerReference','evidenceDigest','reason']);treasuryReason(intent.reason);
      if(!treasuryReference.test(intent.requestId)||!treasuryReference.test(intent.provider)||!treasuryReference.test(intent.providerReference)||!treasuryEvidenceDigest.test(intent.evidenceDigest))controlError('INVALID_EXTERNAL_RECEIPT',400);
      const request=projection.transaction_requests.find(item=>item.id===intent.requestId);
      if(!request)controlError('TREASURY_REQUEST_NOT_FOUND',404);
      if(request.receipt!==null||request.status!=='PREPARED')controlError('TREASURY_RECEIPT_ALREADY_BOUND',409);
      request.status='EVIDENCE_BOUND';
      request.receipt={provider:intent.provider,provider_reference:intent.providerReference,evidence_digest:intent.evidenceDigest,provider_confirmation:'PENDING',confirmation_authority:null,confirmation_scope:null,singular:false,reconciliation_status:'PENDING',external_provider_confirmation_verified:false,external_funds_verified:false};
      transactionRequest=request;
    }else if(intent.operation==='CONFIRM_NUMINA_RECEIPT'){
      treasuryExact(intent,['operation','requestId','reason']);treasuryReason(intent.reason);
      if(!treasuryReference.test(intent.requestId))controlError('INVALID_TREASURY_REQUEST_REFERENCE',400);
      const request=projection.transaction_requests.find(item=>item.id===intent.requestId);
      if(!request)controlError('TREASURY_REQUEST_NOT_FOUND',404);
      if(request.status!=='EVIDENCE_BOUND'||!request.receipt)controlError('TREASURY_RECEIPT_NOT_CONFIRMABLE',409);
      request.status='RECONCILED';
      request.receipt={...request.receipt,provider_confirmation:'CONFIRMED',confirmation_authority:'NUMINA',confirmation_scope:'NUMINA_SYSTEM_OF_RECORD',singular:true,reconciliation_status:'RECONCILED',external_provider_confirmation_verified:false,external_funds_verified:false};
      transactionRequest=request;
    }else{
      const mint=intent.operation==='PREPARE_MINT',usdc=intent.operation==='PREPARE_USDC_DEPOSIT';
      treasuryExact(intent,mint?['operation','amount','networkReference','destinationReference','reason']:usdc?['operation','amount','destinationReference','reason']:['operation','amountMinor','currency','destinationReference','reason']);
      treasuryReason(intent.reason);
      const amount=mint||usdc?intent.amount:intent.amountMinor;
      if(typeof amount!=='string'||!treasuryUnsigned.test(amount)||amount==='0')controlError('INVALID_TRANSACTION_AMOUNT',400);
      if(!treasuryReference.test(intent.destinationReference)||typeof intent.destinationReference!=='string'||(mint&&(!treasuryReference.test(intent.networkReference)||typeof intent.networkReference!=='string'))||(usdc&&(!evmAddress.test(intent.destinationReference)||intent.destinationReference.toLowerCase()!==NUMINA_BASE_USDC.destination_reference))||(!mint&&!usdc&&intent.currency!=='USD'))controlError('INVALID_TRANSACTION_REFERENCE',400);
      if(projection.transaction_requests.length>=100)controlError('TREASURY_REQUEST_CAPACITY',409);
      if(usdc){
        const amountBaseUnits=BigInt(amount)*(10n**BigInt(NUMINA_BASE_USDC.decimals));
        if(amountBaseUnits>uint256Max)controlError('INVALID_TRANSACTION_AMOUNT',400);
        transactionRequest={
          id:eventId,kind:'usdc_transfer_request',status:'PREPARED',destination_reference:NUMINA_BASE_USDC.destination_reference,
          destination_financial_account:NUMINA_BASE_USDC.destination_financial_account,destination_financial_address:NUMINA_BASE_USDC.destination_financial_address,destination_binding_verified:NUMINA_BASE_USDC.destination_binding_verified,
          journal_idempotency_key:eventId,journal_replay_preconditions:['expectedRevision','expectedHead'],
          amount,amount_base_units:amountBaseUnits.toString(),unit:NUMINA_BASE_USDC.unit,decimals:NUMINA_BASE_USDC.decimals,
          network:NUMINA_BASE_USDC.network,chain_id:NUMINA_BASE_USDC.chain_id,network_reference:NUMINA_BASE_USDC.network_reference,token_address:NUMINA_BASE_USDC.token_address,
          source_wallet:null,signer_control_verified:false,source_usdc_balance:null,source_base_eth_gas_balance:null,
          execution_performed:false,broadcast_performed:false,submission_performed:false,transaction_hash:null,receipt:null,
          prerequisite_blockers:[...NUMINA_USDC_PREPARATION_BLOCKERS]
        };
      }else transactionRequest={id:eventId,kind:mint?'mint_request':'bank_transaction_request',status:'PREPARED',destination_reference:intent.destinationReference,...(mint?{amount,unit:'NUSD',network_reference:intent.networkReference}:{amount_minor:amount,currency:intent.currency}),submission_performed:false,receipt:null};
      projection.transaction_requests.push(transactionRequest);
    }
    projection.last_event_id=eventId;
  }
  return {projection,result:{outcome:'FINAL',route:NUMINA_TREASURY_ROUTE,execution_scope:'Numina-native journal',projection,transaction_request:transactionRequest,mint_event:null,bank_transaction:null}};
}

export function treasuryProjectionEquals(left,right){return stable(left)===stable(right);}
