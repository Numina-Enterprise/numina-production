import {WALLET_EXECUTION_POLICY,walletExecutionAuthorized} from '../public/wallet-execution-policy.js';
import {stable,controlHash,controlError} from './control.js';

export const WALLET_EXECUTION_SCHEMA='CREATE TABLE IF NOT EXISTS numina_wallet_deployment_intents (deployment_key TEXT PRIMARY KEY NOT NULL, owner TEXT NOT NULL, attempt_id TEXT NOT NULL, transaction_json TEXT NOT NULL, transaction_hash TEXT, created_at INTEGER NOT NULL)';
const deploymentKey='nusd:'+WALLET_EXECUTION_POLICY.chainId+':'+WALLET_EXECUTION_POLICY.creationSha256;
const exactKeys=(value,keys)=>value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).sort().join(',')===keys.sort().join(',');
const walletStoreHash=value=>typeof value==='string'&&/^0x[0-9a-fA-F]{64}$/.test(value);
function walletIntentTransaction(value){
 const fields=['chainId','genesisHash','from','nonce','gasLimit','gasPrice','maximumFeeBaseUnits','creationSha256'];
 if(!exactKeys(value,fields))controlError('INVALID_DEPLOYMENT_TRANSACTION',400);
 const p=WALLET_EXECUTION_POLICY;
 if(value.chainId!==p.chainId||value.genesisHash!==p.genesisHash||value.from!==p.sender||value.creationSha256!==p.creationSha256)controlError('DEPLOYMENT_PIN_MISMATCH',400);
 for(const key of ['nonce','gasLimit','gasPrice','maximumFeeBaseUnits'])if(typeof value[key]!=='string'||!/^(0|[1-9][0-9]{0,77})$/.test(value[key])||BigInt(value[key])>=(1n<<256n))controlError('INVALID_DEPLOYMENT_QUANTITY',400);
 if(BigInt(value.nonce)>=(1n<<64n)-1n)controlError('INVALID_DEPLOYMENT_QUANTITY',400);
 if(BigInt(value.gasLimit)===0n||BigInt(value.gasLimit)*BigInt(value.gasPrice)>BigInt(value.maximumFeeBaseUnits))controlError('DEPLOYMENT_FEE_BUDGET',400);
 return value;
}
function walletIntentView(row){return row?{schema:'numina.nusd.deployment-intent.v1',attemptId:row.attempt_id,transaction:JSON.parse(row.transaction_json),reportedTransactionHash:row.transaction_hash,status:row.transaction_hash?'HASH_REPORTED':'CLAIMED',createdAt:row.created_at,scope:'Owner intent lock only; a reported hash is not a verified receipt',minted:false,deposited:false}:null;}
export async function readWalletDeploymentIntent(db,owner){
 const row=await db.prepare('SELECT * FROM numina_wallet_deployment_intents WHERE deployment_key=?').bind(deploymentKey).first();
 if(row&&row.owner!==owner)controlError('DEPLOYMENT_OWNER_MISMATCH',403);
 return walletIntentView(row);
}
export async function writeWalletDeploymentIntent(db,owner,body,{policy=WALLET_EXECUTION_POLICY,now=Math.floor(Date.now()/1000)}={}){
 if(body?.action==='claim'){
  if(!walletExecutionAuthorized(policy))controlError('DEPLOYMENT_REVIEWS_REQUIRED',409);
  if(!exactKeys(body,['action','attemptId','transaction'])||typeof body.attemptId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(body.attemptId))controlError('INVALID_DEPLOYMENT_INTENT',400);
  const transaction=walletIntentTransaction(body.transaction),json=stable(transaction);
  const rows=await db.prepare('INSERT INTO numina_wallet_deployment_intents(deployment_key,owner,attempt_id,transaction_json,transaction_hash,created_at) VALUES(?,?,?,?,NULL,?) ON CONFLICT(deployment_key) DO NOTHING RETURNING attempt_id').bind(deploymentKey,owner,body.attemptId,json,now).all();
  const record=await readWalletDeploymentIntent(db,owner);
  if(record.attemptId!==body.attemptId||stable(record.transaction)!==json)controlError('DEPLOYMENT_INTENT_EXISTS',409);
  return {record,fresh:rows.results.length===1,transactionCommitment:await controlHash(transaction)};
 }
 if(body?.action==='report_hash'){
  if(!exactKeys(body,['action','attemptId','transactionHash'])||typeof body.attemptId!=='string'||!walletStoreHash(body.transactionHash))controlError('INVALID_DEPLOYMENT_HASH',400);
  const record=await readWalletDeploymentIntent(db,owner);
  if(!record||record.attemptId!==body.attemptId)controlError('DEPLOYMENT_INTENT_MISMATCH',409);
  const hash=body.transactionHash.toLowerCase();
  if(record.reportedTransactionHash&&record.reportedTransactionHash!==hash)controlError('DEPLOYMENT_HASH_CONFLICT',409);
  await db.prepare('UPDATE numina_wallet_deployment_intents SET transaction_hash=? WHERE deployment_key=? AND owner=? AND attempt_id=? AND (transaction_hash IS NULL OR transaction_hash=?)').bind(hash,deploymentKey,owner,body.attemptId,hash).run();
  const updated=await readWalletDeploymentIntent(db,owner);
  if(updated.reportedTransactionHash!==hash)controlError('DEPLOYMENT_HASH_CONFLICT',409);
  return {record:updated,fresh:false};
 }
 controlError('INVALID_DEPLOYMENT_ACTION',400);
}
