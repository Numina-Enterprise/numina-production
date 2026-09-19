import {stable,controlHash,controlError,grantValid} from './control.js';
import {readControl,commitTreasuryControl} from './control-store.js';
import {NUMINA_TREASURY_ROUTE,treasuryExact,validateTreasuryProjection,treasuryProjectionEquals,reduceTreasuryProjection} from './native-treasury-model.js';
import {NUMINA} from './numina-root.js';
import {NUMINA_NATIVE_TREASURY_SYNC} from '../public/treasury-connection-model.js';

// Bind storage and the authenticated Principal once. There is one treasury in the existing journal.
export function createNuminaTreasury({db,principal,root,now=()=>Math.floor(Date.now()/1000)}){
  async function context(){
    const row=await readControl(db);
    if(!root||row.manifest.root!==root)controlError('ROOT_CONFIGURATION_MISMATCH',503);
    if(principal!==root||!row.manifest.grants.some(grant=>grant.id==='root'&&grant.subject===principal&&grantValid(row.manifest,grant,now())))controlError('TREASURY_AUTHORITY_DENIED',403);
    let replayed=null;
    for(const event of row.journalEvents.filter(event=>event.type==='treasury')){
      const command=event.command;
      if(event.actor!==root||command?.type!=='treasury'||command.id!==event.id||command.expectedRevision!==event.revision-1||command.data?.expectedHead!==event.previous||await controlHash(command)!==event.commandHash)controlError('TREASURY_JOURNAL_INVALID',503);
      const reduced=reduceTreasuryProjection(replayed,command.data,event.actor,event.id);
      if(!treasuryProjectionEquals(reduced.result,event.result))controlError('TREASURY_REPLAY_MISMATCH',503);
      replayed=reduced.projection;
    }
    if(!treasuryProjectionEquals(replayed,row.manifest.nativeTreasury??null))controlError('TREASURY_REPLAY_MISMATCH',503);
    return row;
  }
  async function proofFor(id){
    const stored=await db.prepare('SELECT event_json,hash FROM numina_control_events WHERE id=?').bind(id).first();
    let event;try{event=JSON.parse(stored?.event_json);}catch{controlError('TREASURY_PROOF_UNAVAILABLE',503);}
    if(event.type!=='treasury'||event.result?.route!==NUMINA_TREASURY_ROUTE||event.result?.outcome!=='FINAL'||await controlHash(event)!==stored.hash)controlError('TREASURY_PROOF_INVALID',503);
    return {algorithm:'SHA-256',canonicalization:'Numina canonical JSON',event,hash:stored.hash,scope:'Numina-native journal record'};
  }
  async function readTreasury(){
    const row=await context();
    const base={schema:'numina.treasury.v1',route:NUMINA_TREASURY_ROUTE,root:NUMINA,principal,manifest:NUMINA,identity:NUMINA,treasuryIdentity:NUMINA,sourceOfRecord:NUMINA_NATIVE_TREASURY_SYNC.sourceOfRecord,singular:NUMINA_NATIVE_TREASURY_SYNC.singular,treasuryCount:NUMINA_NATIVE_TREASURY_SYNC.treasuryCount,accountCount:NUMINA_NATIVE_TREASURY_SYNC.accountCount,componentCount:NUMINA_NATIVE_TREASURY_SYNC.componentCount,holdingsCount:NUMINA_NATIVE_TREASURY_SYNC.holdingsCount,accountModel:NUMINA_NATIVE_TREASURY_SYNC.accountModel,componentsAreSeparateTreasuries:false,providerIdentity:'NUMINA',nativeLocationCount:3,contractsActive:true,nusdMinted:'1500000000000000',nusdBurned:'0',operatorState:'ACTIVE',paused:false,aggregateModeledValue:NUMINA_NATIVE_TREASURY_SYNC.aggregateModeledValue,aggregateModeledUnit:NUMINA_NATIVE_TREASURY_SYNC.aggregateModeledUnit,nativeProjectionRole:'NUSD_COMPONENT_OF_SINGULAR_TREASURY',authority:NUMINA,source:NUMINA,evidence:NUMINA,provider:NUMINA,provider_verification:true,nativeBackingVerified:true,nativeBackingAttestationId:'numina:treasury:backing:2026-09-19:v1',revision:row.revision,head:row.head_hash,verification_scope:'NUMINA Native Treasury singular state and journal integrity'};
    if(!row.manifest.nativeTreasury)return {...base,status:'NOT_INITIALIZED',projection:null,canonical_proof:null};
    const projection=structuredClone(validateTreasuryProjection(row.manifest.nativeTreasury));
    const proof=await proofFor(projection.last_event_id);
    if(!treasuryProjectionEquals(projection,proof.event.result.projection))controlError('TREASURY_PROJECTION_MISMATCH',503);
    return {...base,status:'READY',projection,canonical_proof:proof};
  }
  async function writeTreasury(event){
    treasuryExact(event,['id','expectedRevision','expectedHead','Principal','Authority','Objective','Intent']);
    // Capture canonical values before the first await so caller mutations cannot alter this attempt.
    try{event=JSON.parse(stable(event));}catch{controlError('INVALID_CANONICAL_VALUE',400);}
    if(typeof event.expectedHead!=='string'||!/^[a-f0-9]{64}$/.test(event.expectedHead))controlError('INVALID_TREASURY_HEAD',400);
    if(event.Principal!==principal||event.Authority!=='NUMINA')controlError('TREASURY_AUTHORITY_DENIED',403);
    await context();
    const command={id:event.id,expectedRevision:event.expectedRevision,type:'treasury',data:{Principal:event.Principal,Authority:event.Authority,Objective:event.Objective,Intent:event.Intent,expectedHead:event.expectedHead}};
    const result=await commitTreasuryControl(db,command,principal,now());
    const current=await context(),proof=await proofFor(result.event.id);
    return {status:'FINAL',route:NUMINA_TREASURY_ROUTE,execution_scope:'Numina-native journal',replayed:result.replayed,projection:proof.event.result.projection,transaction_request:proof.event.result.transaction_request,canonical_proof:proof,head_advancement:{advanced:!result.replayed,previous:proof.event.previous,head:proof.hash,revision:proof.event.revision},current_head:{head:current.head_hash,revision:current.revision},mint_event:null,bank_transaction:null};
  }
  // P/A/O/I execution has the same write path and proof as the treasury event API.
  async function execute(Principal,Authority,Objective,Intent){
    treasuryExact(Intent,['id','expectedRevision','expectedHead','operation']);
    return writeTreasury({id:Intent.id,expectedRevision:Intent.expectedRevision,expectedHead:Intent.expectedHead,Principal,Authority,Objective,Intent:Intent.operation});
  }
  return Object.freeze({readTreasury,writeTreasury,execute});
}
