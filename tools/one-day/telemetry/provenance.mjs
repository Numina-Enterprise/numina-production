import {createPublicKey,sign,verify} from 'node:crypto';
import {canonical,hash,requireThat,SequenceGuard,toCoreRecord} from './adapters.mjs';

const DOMAIN='NUMINA-TELEMETRY-SIMULATION-RECEIPT-V1\n';
export const fingerprint=key=>hash(createPublicKeyIfNeeded(key).export({format:'der',type:'spki'}));
function createPublicKeyIfNeeded(key){return key?.type==='public'?key:createPublicKey(key);}
export class SimulationPolicy{
 #sequences=new SequenceGuard();#seen=new Set();
 constructor({principals=['simulation-operator'],maxObservations=100000}={}){requireThat(Array.isArray(principals)&&principals.every(x=>typeof x==='string')&&Number.isSafeInteger(maxObservations)&&maxObservations>0,'POLICY_CONFIG');this.principals=new Set(principals);this.maxObservations=maxObservations;}
 decide(record,{principal,action}={}){
  toCoreRecord(record);
  if(!this.principals.has(principal))return {decision:'DENY',reason:'principal_not_authorized'};
  if(action==='tasking_proposal')return {decision:'ESCALATE',reason:'human_review_required_no_dispatch'};
  if(action!=='observe')return {decision:'DENY',reason:'action_not_supported'};
  const identity=record.payload.inputSha256;
  requireThat(typeof identity==='string'&&/^[a-f0-9]{64}$/.test(identity),'RECORD_HASH');
  if(this.#seen.has(identity))return {decision:'DENY',reason:'replayed_observation'};
  if(this.#seen.size>=this.maxObservations)return {decision:'DENY',reason:'simulation_capacity_reached'};
  const decision=this.#sequences.inspect(record);
  this.#seen.add(identity);return decision;
 }
}

export function receiptSigner({privateKey,runId}){
 requireThat(privateKey?.asymmetricKeyType==='ed25519'&&typeof runId==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(runId),'SIGNER_CONFIG');
 let index=0,previous='0'.repeat(64);const keyId=fingerprint(privateKey);
 return (record,decision)=>{
  requireThat(['ALLOW','DENY','ESCALATE'].includes(decision.decision)&&typeof decision.reason==='string','DECISION');
  const body={schema:'numina.telemetry.receipt.v1',classification:'LOCAL_SIMULATION',operationalAuthority:false,runId,index,previous,keyId,record:toCoreRecord(record),decision};
  const bytes=Buffer.from(DOMAIN+canonical(body));const signature=sign(null,bytes,privateKey).toString('base64');
  const envelope={body,signature};previous=hash(canonical(envelope));index++;return envelope;
 };
}

// Caller supplies a trusted test public key; the envelope never supplies its own authority.
export class ReceiptVerifier{
 #index=0;#previous='0'.repeat(64);
 constructor({publicKey,runId}){requireThat(publicKey?.asymmetricKeyType==='ed25519'&&typeof runId==='string','VERIFIER_CONFIG');this.publicKey=publicKey;this.runId=runId;}
 accept(envelope){
  try{
   requireThat(envelope&&Object.keys(envelope).sort().join(',')==='body,signature','ENVELOPE_FIELDS');
   const b=envelope.body;
   requireThat(b.schema==='numina.telemetry.receipt.v1'&&b.classification==='LOCAL_SIMULATION'&&b.operationalAuthority===false,'RECEIPT_PROFILE');
   requireThat(b.runId===this.runId&&b.index===this.#index&&b.previous===this.#previous&&b.keyId===fingerprint(this.publicKey),'RECEIPT_BINDING');
   requireThat(typeof envelope.signature==='string'&&/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature),'SIGNATURE_ENCODING');
   requireThat(Buffer.from(envelope.signature,'base64').toString('base64')===envelope.signature,'SIGNATURE_ENCODING');
   requireThat(verify(null,Buffer.from(DOMAIN+canonical(b)),this.publicKey,Buffer.from(envelope.signature,'base64')),'SIGNATURE_INVALID');
   this.#previous=hash(canonical(envelope));this.#index++;return true;
  }catch{return false;}
 }
}
