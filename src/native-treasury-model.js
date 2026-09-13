import {controlError,stable} from './control.js';

export const NUMINA_TREASURY_ROUTE='numina.treasury.v1';
export const NUMINA_TREASURY_MODEL=Object.freeze({schema:'numina.treasury.projection.v1',unit:'NUSD',authority:'NUMINA',verification:'VERIFIED',system_of_record:'NUMINA',scope:'Numina-native'});
export const NUMINA_TREASURY_INITIAL_BALANCE='500000000000000';
const treasuryUnsigned=/^(0|[1-9][0-9]{0,77})$/;
const treasurySigned=/^-?[1-9][0-9]{0,77}$/;
const treasuryReference=/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/;
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
export function reduceTreasuryProjection(current,data,actor,eventId){
  treasuryExact(data,['Principal','Authority','Objective','Intent','expectedHead']);
  if(data.Principal!==actor||data.Authority!=='NUMINA')controlError('TREASURY_AUTHORITY_DENIED',403);
  const intent=data.Intent;
  if(!intent||typeof intent.operation!=='string')controlError('INVALID_TREASURY_INTENT',400);
  const objectives={INITIALIZE:'treasury.initialize',ADJUST_PROJECTION:'treasury.project',PREPARE_MINT:'treasury.mint.prepare',PREPARE_BANK_TRANSACTION:'treasury.bank.prepare'};
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
    }else{
      const mint=intent.operation==='PREPARE_MINT';
      treasuryExact(intent,mint?['operation','amount','networkReference','destinationReference','reason']:['operation','amountMinor','currency','destinationReference','reason']);
      treasuryReason(intent.reason);
      const amount=mint?intent.amount:intent.amountMinor;
      if(typeof amount!=='string'||!treasuryUnsigned.test(amount)||amount==='0')controlError('INVALID_TRANSACTION_AMOUNT',400);
      if(!treasuryReference.test(intent.destinationReference)||typeof intent.destinationReference!=='string'||(mint&&(!treasuryReference.test(intent.networkReference)||typeof intent.networkReference!=='string'))||(!mint&&intent.currency!=='USD'))controlError('INVALID_TRANSACTION_REFERENCE',400);
      if(projection.transaction_requests.length>=100)controlError('TREASURY_REQUEST_CAPACITY',409);
      transactionRequest={id:eventId,kind:mint?'mint_request':'bank_transaction_request',status:'PREPARED',destination_reference:intent.destinationReference,...(mint?{amount,unit:'NUSD',network_reference:intent.networkReference}:{amount_minor:amount,currency:intent.currency}),submission_performed:false,receipt:null};
      projection.transaction_requests.push(transactionRequest);
    }
    projection.last_event_id=eventId;
  }
  return {projection,result:{outcome:'FINAL',route:NUMINA_TREASURY_ROUTE,execution_scope:'Numina-native journal',projection,transaction_request:transactionRequest,mint_event:null,bank_transaction:null}};
}

export function treasuryProjectionEquals(left,right){return stable(left)===stable(right);}
