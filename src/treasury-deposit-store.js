import {stable,controlHash,controlError} from './control.js';
import {STRIPE_TREASURY_FINANCIAL_ACCOUNT} from './stripe-treasury.js';
import {STRIPE_DEPOSIT_CAPABILITY,readStripeDepositInstructions,readStripeDepositReceipt} from './stripe-deposit-provider.js';

export const TREASURY_DEPOSIT_SCHEMA=[
  'CREATE TABLE IF NOT EXISTS numina_deposit_intents (id TEXT PRIMARY KEY NOT NULL, owner TEXT NOT NULL, idempotency_key TEXT NOT NULL, intent_hash TEXT NOT NULL, intent_json TEXT NOT NULL, authorization_json TEXT NOT NULL, created_at TEXT NOT NULL, poll_generation INTEGER NOT NULL DEFAULT 0, UNIQUE(owner,idempotency_key))',
  'CREATE TABLE IF NOT EXISTS numina_deposit_observations (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, intent_id TEXT NOT NULL, generation INTEGER NOT NULL, observed_at TEXT NOT NULL, observation_json TEXT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS numina_deposit_observation_intent ON numina_deposit_observations(intent_id,observed_at,sequence)',
  'CREATE TABLE IF NOT EXISTS numina_deposit_receipts (receipt_id TEXT PRIMARY KEY NOT NULL, intent_id TEXT NOT NULL UNIQUE, financial_account TEXT NOT NULL, created_at TEXT NOT NULL)'
];
const depositExact=(value,keys)=>value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
function depositKey(key){if(typeof key!=='string'||!/^[A-Za-z0-9_-]{16,100}$/.test(key))controlError('INVALID_DEPOSIT_IDEMPOTENCY_KEY',400);return key;}
function depositDecimal(amount,decimals){
  if(typeof amount!=='string'||!new RegExp('^(0|[1-9][0-9]{0,35})(\\.[0-9]{1,'+decimals+'})?$').test(amount))controlError('INVALID_DEPOSIT_AMOUNT',400);
  const [whole,fraction='']=amount.split('.'),units=BigInt(whole)*10n**BigInt(decimals)+BigInt(fraction.padEnd(decimals,'0'));
  if(units<=0n||units>=(1n<<256n))controlError('INVALID_DEPOSIT_AMOUNT',400);
  return units.toString();
}
export function validateDepositIntent(intent){
  if(!depositExact(intent,['source','settlement','financialAccount'])||!depositExact(intent.source,['currency','amount'])||!depositExact(intent.settlement,['currency','amount']))controlError('INVALID_DEPOSIT_INTENT',400);
  if(intent.source.currency!=='NUSD'||intent.settlement.currency!=='USD')controlError('DEPOSIT_CURRENCY_MISMATCH',400);
  if(intent.financialAccount!==STRIPE_TREASURY_FINANCIAL_ACCOUNT)controlError('DEPOSIT_DESTINATION_MISMATCH',400);
  const sourceBaseUnits=depositDecimal(intent.source.amount,18),usdMinor=depositDecimal(intent.settlement.amount,2);
  // Requests remain exact decimal strings. No Number conversion or automatic
  // parity conversion is permitted, including historical 500T allocations.
  if(BigInt(usdMinor)>9223372036854775807n)controlError('DEPOSIT_AMOUNT_OUT_OF_RANGE',400);
  return {...intent,source:{...intent.source,baseUnits:sourceBaseUnits,decimals:18},settlement:{...intent.settlement,minorUnits:usdMinor,decimals:2}};
}
function depositPrepareAuthorization(body){
  if(!depositExact(body,['action','idempotencyKey','intent','authorization'])||!['prepare_external_funding','refresh_instructions'].includes(body.action))controlError('INVALID_DEPOSIT_ACTION',400);
  depositKey(body.idempotencyKey);validateDepositIntent(body.intent);
  const expected={action:body.action,idempotencyKey:body.idempotencyKey,intent:body.intent,confirmed:true};
  if(!depositExact(body.authorization,Object.keys(expected))||stable(body.authorization)!==stable(expected))controlError('EXPLICIT_DEPOSIT_AUTHORIZATION_REQUIRED',403);
}
function depositPollAuthorization(body){
  if(!depositExact(body,['action','idempotencyKey','providerReceiptId','receiptKind','authorization'])||body.action!=='reconcile')controlError('INVALID_DEPOSIT_ACTION',400);
  depositKey(body.idempotencyKey);
  if(typeof body.providerReceiptId!=='string'||!/^[A-Za-z0-9_]{3,160}$/.test(body.providerReceiptId)||!['received_credit','inbound_transfer'].includes(body.receiptKind))controlError('INVALID_PROVIDER_RECEIPT_ID',400);
  const expected={action:body.action,idempotencyKey:body.idempotencyKey,providerReceiptId:body.providerReceiptId,receiptKind:body.receiptKind,confirmed:true};
  if(!depositExact(body.authorization,Object.keys(expected))||stable(body.authorization)!==stable(expected))controlError('EXPLICIT_DEPOSIT_AUTHORIZATION_REQUIRED',403);
}
export function validateDepositRequest(body){
  if(body?.action==='submit')controlError('FUNDED_USD_SOURCE_AND_SUPPORTED_WRITE_PROVIDER_REQUIRED',409);
  if(['prepare_external_funding','refresh_instructions'].includes(body?.action))depositPrepareAuthorization(body);
  else depositPollAuthorization(body);
}
function depositView(row,observation=null){
  return {schema:'numina.treasury.deposit.v1',id:row.id,idempotencyKey:row.idempotency_key,intentHash:row.intent_hash,createdAt:row.created_at,
    intendedState:JSON.parse(row.intent_json),authorization:JSON.parse(row.authorization_json),
    softwareState:{status:observation?.status??'AUTHORIZED_INSTRUCTIONS_PENDING',durableIntent:true,submissionPerformed:false,nativeJournalChanged:false},
    providerConfirmedState:observation?.providerConfirmedState??{usdDepositVerified:false,receiptId:null,transactionId:null},
    sourceEvidence:{nusdRedemptionVerified:false,usdSourceFundsVerified:false,nusdMintIsUsdBackingEvidence:false},
    observation,capability:STRIPE_DEPOSIT_CAPABILITY,submissionPerformed:false,settled:false,nusdSettlementVerified:false,
    scope:'USD credit readback is separate from intended NUSD redemption, canonical mint/deployment and Numina journal state'};
}
async function depositRow(db,owner,key){
  if(!db?.prepare)controlError('DEPOSIT_STORAGE_UNAVAILABLE',503);
  return db.prepare('SELECT * FROM numina_deposit_intents WHERE owner=? AND idempotency_key=?').bind(owner,depositKey(key)).first();
}
export async function readDepositIntent(db,owner,key){
  const row=await depositRow(db,owner,key);if(!row)controlError('DEPOSIT_INTENT_NOT_FOUND',404);
  // A correlated terminal return/failure revokes verification even if an older
  // request observes it after a newer poll. Never hide it behind request order.
  const latest=await db.prepare('SELECT observation_json FROM numina_deposit_observations WHERE intent_id=? ORDER BY CASE WHEN json_extract(observation_json,\'$.status\')=\'PROVIDER_FUNDING_REJECTED\' THEN 1 ELSE 0 END DESC,generation DESC,sequence DESC LIMIT 1').bind(row.id).first();
  return depositView(row,latest?JSON.parse(latest.observation_json):null);
}
async function depositSaveObservation(db,row,observation){
  const id=await controlHash({intentId:row.id,observation});
  await db.prepare('INSERT INTO numina_deposit_observations(id,intent_id,generation,observed_at,observation_json) VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,row.id,observation.pollGeneration,observation.observedAt,stable(observation)).run();
}
async function depositNextGeneration(db,row){
  const result=await db.prepare('UPDATE numina_deposit_intents SET poll_generation=poll_generation+1 WHERE id=? RETURNING poll_generation').bind(row.id).first();
  return result.poll_generation;
}
function depositErrorObservation(error,observedAt,pollGeneration,previous=null){
  const allowed=['STRIPE_DEPOSIT_NOT_CONNECTED','STRIPE_DEPOSIT_TIMEOUT','STRIPE_DEPOSIT_PROVIDER_REJECTED','STRIPE_DEPOSIT_INVALID_RESPONSE','STRIPE_DEPOSIT_UNAVAILABLE','STRIPE_DEPOSIT_ACCOUNT_CLOSED'];
  return {observedAt,pollGeneration,status:'PROVIDER_READ_FAILED',error:allowed.includes(error.code)?error.code:'STRIPE_DEPOSIT_UNAVAILABLE',
    response:error.providerEvidence??null,providerResponses:error.providerResponses??[],providerConfirmedState:{...(previous??{usdDepositVerified:false,receiptId:null,transactionId:null}),verificationFresh:false},submissionPerformed:false};
}
export async function prepareDepositInstructions(db,owner,body,env,{readInstructions=readStripeDepositInstructions,now=()=>new Date().toISOString(),providerOptions={}}={}){
  depositPrepareAuthorization(body);
  if(!db?.prepare)controlError('DEPOSIT_STORAGE_UNAVAILABLE',503);
  if(body.action==='refresh_instructions'&&!await depositRow(db,owner,body.idempotencyKey))controlError('DEPOSIT_INTENT_NOT_FOUND',404);
  const intent=validateDepositIntent(body.intent),hash=await controlHash(intent),createdAt=now(),id=await controlHash({owner,key:body.idempotencyKey});
  const inserted=await db.prepare('INSERT INTO numina_deposit_intents(id,owner,idempotency_key,intent_hash,intent_json,authorization_json,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(owner,idempotency_key) DO NOTHING RETURNING id').bind(id,owner,body.idempotencyKey,hash,stable(intent),stable({principal:owner,...body.authorization}),createdAt).all();
  const row=await depositRow(db,owner,body.idempotencyKey);
  if(row.intent_hash!==hash||row.intent_json!==stable(intent))controlError('DEPOSIT_IDEMPOTENCY_CONFLICT',409);
  if(inserted.results.length===0&&body.action!=='refresh_instructions')return {record:await readDepositIntent(db,owner,body.idempotencyKey),replayed:true};
  const bound=await db.prepare('SELECT receipt_id FROM numina_deposit_receipts WHERE intent_id=? LIMIT 1').bind(id).first();
  if(bound)controlError('DEPOSIT_RECEIPT_BINDING_CONFLICT',409);
  const pollGeneration=inserted.results.length===1?0:await depositNextGeneration(db,row);
  let observation;
  try{
    const provider=await readInstructions(env,providerOptions);
    observation={observedAt:createdAt,pollGeneration,status:provider.destinationAvailable?'AWAITING_EXTERNAL_USD_FUNDING':'USD_FUNDING_DESTINATION_UNAVAILABLE',
      providerResponses:provider.responses,providerConfirmedState:{usdDepositVerified:false,receiptId:null,transactionId:null,balances:provider.balances},
      instructions:{mode:'EXTERNAL_BANK_PUSH',financialAccount:intent.financialAccount,amountMinor:intent.settlement.minorUnits,currency:'usd',
        financialAddresses:provider.addresses,dashboardUrl:STRIPE_DEPOSIT_CAPABILITY.dashboardUrl,
        prerequisites:['SEPARATELY_VERIFY_NUSD_REDEMPTION_OR_CONVERSION','VERIFY_AVAILABLE_USD_AT_EXTERNAL_BANK','RETRIEVE_CURRENT_USD_BANK_DETAILS_FROM_STRIPE','AUTHORIZE_EXACT_USD_TRANSFER_AT_EXTERNAL_BANK'],
        steps:['Obtain verified USD proceeds through a separately authorized NUSD redemption or conversion.','Open the exact financial account in Stripe, choose Add funds, then Manually transfer from your bank, and retrieve current USD bank details.','Initiate the exact USD amount through your external bank using its supported rail.','Read back the resulting Stripe received credit or inbound transfer ID and reconcile its posted transaction.'],
        usdSourceFundsVerified:false,conversionVerified:false,bankTransferPerformed:false,submissionPerformed:false},submissionPerformed:false};
  }catch(error){observation=depositErrorObservation(error,createdAt,pollGeneration);}
  await depositSaveObservation(db,row,{...observation,authorization:{principal:owner,...body.authorization}});
  return {record:await readDepositIntent(db,owner,body.idempotencyKey),replayed:false};
}
function depositMatch(record,provider,instruction){
  const receipt=provider.receipt,intent=record.intendedState;
  const railMatched=provider.kind==='received_credit'?receipt.type==='bank_transfer'&&['ach','rtp','us_domestic_wire'].includes(receipt.bankTransfer?.network)&&instruction?.instructions?.financialAddresses?.some(a=>a.id===receipt.bankTransfer?.financialAddress):
    receipt.type==='bank_debit'&&receipt.bankDebit?.paymentMethodType==='us_bank_account'&&(receipt.status!=='succeeded'||receipt.bankDebit?.credited?.currency==='usd'&&receipt.bankDebit.credited.value===intent.settlement.minorUnits);
  const matches=railMatched&&receipt.financialAccount===intent.financialAccount&&receipt.livemode===true&&receipt.amount.currency==='usd'&&receipt.amount.value===intent.settlement.minorUnits&&Date.parse(receipt.created)>=Date.parse(record.createdAt);
  if(!matches)return {status:'PROVIDER_RECEIPT_MISMATCH',verified:false,transaction:null};
  if(['failed','returned'].includes(receipt.status))return {status:'PROVIDER_FUNDING_REJECTED',verified:false,transaction:null};
  if(receipt.status!=='succeeded')return {status:'PROVIDER_FUNDING_PENDING',verified:false,transaction:null};
  const relevant=provider.transactions.filter(t=>t.financialAccount===intent.financialAccount&&t.livemode===true&&t.flow.type===provider.kind&&t.flow.reference===receipt.id);
  const transaction=relevant.length===1?relevant[0]:null;
  const verified=provider.complete&&transaction?.status==='posted'&&Date.parse(transaction.created)>=Date.parse(record.createdAt)&&transaction.amount.currency==='usd'&&transaction.amount.value===intent.settlement.minorUnits&&
    transaction.balanceImpact.available.currency==='usd'&&transaction.balanceImpact.available.value===intent.settlement.minorUnits&&
    transaction.balanceImpact.inboundPending.currency==='usd'&&['0','-'+intent.settlement.minorUnits].includes(transaction.balanceImpact.inboundPending.value)&&
    transaction.balanceImpact.outboundPending.currency==='usd'&&transaction.balanceImpact.outboundPending.value==='0';
  return {status:verified?'USD_RECEIPT_RECONCILED':'PROVIDER_TRANSACTION_UNRECONCILED',verified:Boolean(verified),transaction};
}
export async function reconcileDeposit(db,owner,body,env,{readReceipt=readStripeDepositReceipt,now=()=>new Date().toISOString(),providerOptions={}}={}){
  depositPollAuthorization(body);
  const record=await readDepositIntent(db,owner,body.idempotencyKey),row=await depositRow(db,owner,body.idempotencyKey),observedAt=now();
  const bound=await db.prepare('SELECT receipt_id FROM numina_deposit_receipts WHERE intent_id=? LIMIT 1').bind(record.id).first();
  if(bound&&bound.receipt_id!==body.providerReceiptId)controlError('DEPOSIT_RECEIPT_BINDING_CONFLICT',409);
  const pollGeneration=await depositNextGeneration(db,row);
  let provider;
  try{provider=await readReceipt(env,body.providerReceiptId,body.receiptKind,providerOptions);}
  catch(error){await depositSaveObservation(db,row,{...depositErrorObservation(error,observedAt,pollGeneration,record.providerConfirmedState),authorization:{principal:owner,...body.authorization}});return {record:await readDepositIntent(db,owner,body.idempotencyKey),replayed:false};}
  const instructionRow=await db.prepare('SELECT observation_json FROM numina_deposit_observations WHERE intent_id=? AND json_extract(observation_json,\'$.instructions\') IS NOT NULL ORDER BY generation DESC,sequence DESC LIMIT 1').bind(row.id).first();
  const result=depositMatch(record,provider,instructionRow?JSON.parse(instructionRow.observation_json):null);
  // Reserve a correlated receipt globally even when pending/returned. The same
  // provider flow cannot be assigned to multiple funding intents on later polls.
  if(!['PROVIDER_RECEIPT_MISMATCH'].includes(result.status)){
    const existing=await db.prepare('SELECT intent_id FROM numina_deposit_receipts WHERE receipt_id=?').bind(provider.receipt.id).first();
    if(existing&&existing.intent_id!==record.id)controlError('PROVIDER_RECEIPT_ALREADY_ALLOCATED',409);
    await db.prepare('INSERT INTO numina_deposit_receipts(receipt_id,intent_id,financial_account,created_at) VALUES(?,?,?,?) ON CONFLICT DO NOTHING').bind(provider.receipt.id,record.id,record.intendedState.financialAccount,observedAt).run();
    const claimed=await db.prepare('SELECT intent_id FROM numina_deposit_receipts WHERE receipt_id=?').bind(provider.receipt.id).first();
    if(!claimed)controlError('DEPOSIT_RECEIPT_BINDING_CONFLICT',409);
    if(claimed.intent_id!==record.id)controlError('PROVIDER_RECEIPT_ALREADY_ALLOCATED',409);
  }
  const latestClaim=await db.prepare('SELECT receipt_id FROM numina_deposit_receipts WHERE intent_id=? LIMIT 1').bind(record.id).first();
  if(latestClaim&&latestClaim.receipt_id!==body.providerReceiptId)controlError('DEPOSIT_RECEIPT_BINDING_CONFLICT',409);
  const observation={observedAt,pollGeneration,status:result.status,providerResponses:provider.responses,
    providerConfirmedState:{usdDepositVerified:result.verified,receiptId:provider.receipt.id,transactionId:result.transaction?.id??null,
      receiptStatus:provider.receipt.status,transactionStatus:result.transaction?.status??null,balances:provider.balances,
      correlation:'OWNER_SELECTED_PROVIDER_ID_WITH_EXACT_USD_READBACK',nusdOriginVerified:false,verificationFresh:true},
    reconciliation:{amountCurrencyAccountMatched:result.status!=='PROVIDER_RECEIPT_MISMATCH',complete:provider.complete,
      balanceSnapshotIsDepositProof:false,usdReceiptVerified:result.verified,nusdConversionVerified:false},submissionPerformed:false};
  await depositSaveObservation(db,row,{...observation,authorization:{principal:owner,...body.authorization}});
  return {record:await readDepositIntent(db,owner,body.idempotencyKey),replayed:false};
}
