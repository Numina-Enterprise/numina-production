import {stable,controlHash,controlError,initialControlState,reduceControl,verifiedActions,grantValid,authorizeControl} from './control.js';
export const CONTROL_SCHEMA=[
 'CREATE TABLE numina_control_state (id INTEGER PRIMARY KEY NOT NULL, revision INTEGER NOT NULL, state_json TEXT NOT NULL, state_hash TEXT NOT NULL, head_hash TEXT NOT NULL, mutation_id TEXT NOT NULL)',
 'CREATE TABLE numina_control_events (id TEXT PRIMARY KEY NOT NULL, revision INTEGER NOT NULL, actor TEXT NOT NULL, command_hash TEXT NOT NULL, event_json TEXT NOT NULL, hash TEXT NOT NULL)',
 'CREATE UNIQUE INDEX numina_control_event_revision ON numina_control_events(revision)'
];
export async function readControl(db){
  if(!db)controlError('STORAGE_UNAVAILABLE',503);
  const [stateRows,events]=await db.batch([db.prepare('SELECT * FROM numina_control_state WHERE id=1'),db.prepare('SELECT id,revision,hash,event_json FROM numina_control_events ORDER BY revision')]);
  const row=stateRows.results[0];if(!row)controlError('CONTROL_NOT_INITIALIZED',503);
  let state;try{state=JSON.parse(row.state_json);}catch{controlError('STATE_CORRUPT',503);}
  if(state.schema!==1||!Array.isArray(state.grants)||!Array.isArray(state.requests)||!Array.isArray(state.evidence)||!Array.isArray(state.records)||await controlHash(state)!==row.state_hash)controlError('STATE_CORRUPT',503);
  let previous=null,index=0,lastEvent;
  for(const entry of events.results){let event;try{event=JSON.parse(entry.event_json);}catch{controlError('JOURNAL_CORRUPT',503);}
    if(entry.revision!==index++||event.revision!==entry.revision||event.id!==entry.id||event.previous!==previous||await controlHash(event)!==entry.hash)controlError('JOURNAL_CORRUPT',503);previous=entry.hash;lastEvent=event;
  }
  if(index!==row.revision+1||previous!==row.head_hash||lastEvent?.id!==row.mutation_id||lastEvent?.stateHash!==row.state_hash)controlError('EVIDENCE_HEAD_CORRUPT',503);
  for(const node of state.evidence){const {hash,...value}=node;if(await controlHash(value)!==hash)controlError('EVIDENCE_CORRUPT',503);}
  return {...row,state,eventCount:index,journalEvents:events.results.map(entry=>JSON.parse(entry.event_json))};
}
export async function bootstrapControl(db,owner,now){
  const count=await db.prepare('SELECT COUNT(*) AS n FROM numina_control_events').first();if(count.n!==0)controlError('ALREADY_INITIALIZED',409);
  const state=initialControlState(owner,now),stateHash=await controlHash(state),event={id:'genesis',revision:0,actor:owner,at:now,type:'bootstrap',previous:null,stateHash};const hash=await controlHash(event);
  try{await db.batch([
    db.prepare('INSERT INTO numina_control_state(id,revision,state_json,state_hash,head_hash,mutation_id) VALUES(1,0,?,?,?,?)').bind(stable(state),stateHash,hash,'genesis'),
    db.prepare('INSERT INTO numina_control_events(id,revision,actor,command_hash,event_json,hash) VALUES(?,0,?,?,?,?)').bind('genesis',owner,await controlHash({type:'bootstrap',owner}),stable(event),hash)
  ]);}catch{controlError('BOOTSTRAP_CONFLICT',409);}
  return {initialized:true,revision:0,stateHash};
}
export async function controlSnapshot(db,actor,now){const row=await readControl(db);if(!row.state.grants.some(g=>g.subject===actor&&grantValid(row.state,g,now)))controlError('AUTHORITY_DENIED',403);
  const allowed=new Set(row.state.requests.filter(r=>actor===row.state.root||authorizeControl(row.state,actor,'record.write',r.wants.resource,now)).map(r=>r.id));
  const visible=structuredClone(row.state);if(actor!==visible.root){visible.requests=visible.requests.filter(r=>allowed.has(r.id));visible.evidence=visible.evidence.filter(e=>allowed.has(e.requestId));visible.records=visible.records.filter(r=>allowed.has(r.requestId));const ids=new Set(visible.grants.filter(g=>g.subject===actor).map(g=>g.id));for(const id of [...ids]){let g=visible.grants.find(g=>g.id===id);while(g?.parent){ids.add(g.parent);g=visible.grants.find(p=>p.id===g.parent);}}visible.grants=visible.grants.filter(g=>ids.has(g.id));}
  // Treasury projections are exposed only through the canonical readTreasury interface.
  delete visible.nativeTreasury;
  delete visible.frontier;
  return {revision:row.revision,stateHash:row.state_hash,evidenceHead:row.head_hash,projection:actor===row.state.root?'complete':'authority-scoped',state:visible,decisions:(await verifiedActions(row.state,row.revision,now,actor)).filter(d=>allowed.has(d.requestId))};
}
function controlResult(prior,replayed){const event=typeof prior.event_json==='string'?JSON.parse(prior.event_json):prior.event;return {replayed,event:{id:event.id,revision:event.revision,actor:event.actor,type:event.type,result:event.result},eventHash:prior.hash};}
export async function commitControl(db,command,actor,now){
  if(!command||typeof command.id!=='string'||!Number.isSafeInteger(command.expectedRevision))controlError('INVALID_COMMAND',400);
  const commandHash=await controlHash(command),prior=await db.prepare('SELECT actor,command_hash,event_json,hash FROM numina_control_events WHERE id=?').bind(command.id).first();
  if(prior){if(prior.actor!==actor||prior.command_hash!==commandHash)controlError('IDEMPOTENCY_CONFLICT',409);return controlResult(prior,true);}
  const row=await readControl(db);if(row.revision>=2048)controlError('EVENT_CAPACITY',409);
  if(command.type==='treasury'&&command.data?.expectedHead!==row.head_hash)controlError('STALE_TREASURY_HEAD',409);
  const reduced=await reduceControl(row.state,command,actor,row.revision,now),stateHash=await controlHash(reduced.state);
  const event={id:command.id,revision:row.revision+1,actor,at:now,type:command.type,command,commandHash,previous:row.head_hash,stateHash,parents:reduced.parents,result:reduced.result,decisionsHash:await controlHash(reduced.decisions)};const hash=await controlHash(event);
  // Conservative transaction-time fence: no previously active grant/evidence may expire while this command commits.
  const validUntil=Math.min(now+5,...row.state.grants.filter(g=>g.expiresAt>now).map(g=>g.expiresAt),...row.state.evidence.filter(e=>e.expiresAt>now).map(e=>e.expiresAt),...(row.state.frontier?.policies||[]).filter(p=>p.expiresAt>now).map(p=>p.expiresAt),...(row.state.frontier?.approvals||[]).filter(a=>a.expiresAt>now).map(a=>a.expiresAt));
  let failure;try{await db.batch([
    db.prepare('UPDATE numina_control_state SET revision=?,state_json=?,state_hash=?,head_hash=?,mutation_id=? WHERE id=1 AND revision=? AND head_hash=? AND ? > unixepoch()').bind(event.revision,stable(reduced.state),stateHash,hash,command.id,row.revision,row.head_hash,validUntil),
    db.prepare('INSERT INTO numina_control_events(id,revision,actor,command_hash,event_json,hash) SELECT ?,?,?,?,?,? FROM numina_control_state WHERE id=1 AND mutation_id=? AND head_hash=? AND NOT EXISTS(SELECT 1 FROM numina_control_events WHERE id=?)').bind(command.id,event.revision,actor,commandHash,stable(event),hash,command.id,hash,command.id)
  ]);}catch(e){failure=e;}
  const persisted=await db.prepare('SELECT actor,command_hash,event_json,hash FROM numina_control_events WHERE id=?').bind(command.id).first();
  if(persisted){if(persisted.actor!==actor||persisted.command_hash!==commandHash)controlError('IDEMPOTENCY_CONFLICT',409);return controlResult(persisted,persisted.hash!==hash);}
  if(failure)throw failure;controlError('STALE_REVISION',409);
}
