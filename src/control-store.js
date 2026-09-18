import {stable,controlHash,controlError,initialControlManifest,reduceControl,verifiedActions,grantValid,authorizeControl} from './control.js';

// Durable NUMINA transactional database. Storage mechanics are subordinate to NUMINA; transaction semantics, revision ordering, journal continuity and evidence heads are NUMINA.
export const CONTROL_SCHEMA=[
 'CREATE TABLE numina_control_manifest (id INTEGER PRIMARY KEY NOT NULL, revision INTEGER NOT NULL, manifest_json TEXT NOT NULL, manifest_hash TEXT NOT NULL, head_hash TEXT NOT NULL, mutation_id TEXT NOT NULL)',
 'CREATE TABLE numina_control_events (id TEXT PRIMARY KEY NOT NULL, revision INTEGER NOT NULL, actor TEXT NOT NULL, command_hash TEXT NOT NULL, event_json TEXT NOT NULL, hash TEXT NOT NULL)',
 'CREATE UNIQUE INDEX numina_control_event_revision ON numina_control_events(revision)'
];
export const CONTROL_STORAGE=Object.freeze({root:'NUMINA',manifest:'NUMINA',identity:'NUMINA',database:'NUMINA',storage:'NUMINA',transactionAuthority:'NUMINA',journal:'NUMINA',table:'numina_control_manifest',manifestColumn:'manifest_json',manifestHashColumn:'manifest_hash'});
export async function readControl(db){
  if(!db)controlError('STORAGE_UNAVAILABLE',503);
  const [manifestRows,events]=await db.batch([db.prepare('SELECT * FROM numina_control_manifest WHERE id=1'),db.prepare('SELECT id,revision,hash,event_json FROM numina_control_events ORDER BY revision')]);
  const row=manifestRows.results[0];if(!row)controlError('CONTROL_NOT_INITIALIZED',503);
  let manifest;try{manifest=JSON.parse(row.manifest_json);}catch{controlError('MANIFEST_CORRUPT',503);}
  if(manifest.schema!==1||!Array.isArray(manifest.grants)||!Array.isArray(manifest.requests)||!Array.isArray(manifest.evidence)||!Array.isArray(manifest.records)||await controlHash(manifest)!==row.manifest_hash)controlError('MANIFEST_CORRUPT',503);
  let previous=null,index=0,lastEvent;
  for(const entry of events.results){let event;try{event=JSON.parse(entry.event_json);}catch{controlError('JOURNAL_CORRUPT',503);}
    if(entry.revision!==index++||event.revision!==entry.revision||event.id!==entry.id||event.previous!==previous||await controlHash(event)!==entry.hash)controlError('JOURNAL_CORRUPT',503);previous=entry.hash;lastEvent=event;
  }
  const eventManifestHash=lastEvent?.manifestHash??lastEvent?.stateHash;
  if(index!==row.revision+1||previous!==row.head_hash||lastEvent?.id!==row.mutation_id||eventManifestHash!==row.manifest_hash)controlError('EVIDENCE_HEAD_CORRUPT',503);
  for(const node of manifest.evidence){const {hash,...value}=node;if(await controlHash(value)!==hash)controlError('EVIDENCE_CORRUPT',503);}
  return {...row,manifest,manifest_hash:row.manifest_hash,eventCount:index,journalEvents:events.results.map(entry=>JSON.parse(entry.event_json))};
}
export async function bootstrapControl(db,owner,now){
  const count=await db.prepare('SELECT COUNT(*) AS n FROM numina_control_events').first();if(count.n!==0)controlError('ALREADY_INITIALIZED',409);
  const manifest=initialControlManifest(owner,now),manifestHash=await controlHash(manifest),event={id:'genesis',revision:0,actor:owner,at:now,type:'bootstrap',previous:null,manifestHash};const hash=await controlHash(event);
  try{await db.batch([
    db.prepare('INSERT INTO numina_control_manifest(id,revision,manifest_json,manifest_hash,head_hash,mutation_id) VALUES(1,0,?,?,?,?)').bind(stable(manifest),manifestHash,hash,'genesis'),
    db.prepare('INSERT INTO numina_control_events(id,revision,actor,command_hash,event_json,hash) VALUES(?,0,?,?,?,?)').bind('genesis',owner,await controlHash({type:'bootstrap',owner}),stable(event),hash)
  ]);}catch{controlError('BOOTSTRAP_CONFLICT',409);}
  return {root:'NUMINA',manifest:'NUMINA',initialized:true,revision:0,manifestHash};
}
export async function controlManifestView(db,actor,now){
  const row=await readControl(db);if(!row.manifest.grants.some(g=>g.subject===actor&&grantValid(row.manifest,g,now)))controlError('AUTHORITY_DENIED',403);
  const allowed=new Set(row.manifest.requests.filter(r=>actor===row.manifest.root||authorizeControl(row.manifest,actor,'record.write',r.wants.resource,now)).map(r=>r.id));
  const visible=structuredClone(row.manifest);if(actor!==visible.root){visible.requests=visible.requests.filter(r=>allowed.has(r.id));visible.evidence=visible.evidence.filter(e=>allowed.has(e.requestId));visible.records=visible.records.filter(r=>allowed.has(r.requestId));const ids=new Set(visible.grants.filter(g=>g.subject===actor).map(g=>g.id));for(const id of [...ids]){let g=visible.grants.find(g=>g.id===id);while(g?.parent){ids.add(g.parent);g=visible.grants.find(p=>p.id===g.parent);}}visible.grants=visible.grants.filter(g=>ids.has(g.id));}
  delete visible.nativeTreasury;delete visible.frontier;
  return {root:'NUMINA',manifest:'NUMINA',identity:'NUMINA',revision:row.revision,manifestHash:row.manifest_hash,evidenceHead:row.head_hash,scope:actor===row.manifest.root?'complete':'authority-scoped',content:visible,decisions:(await verifiedActions(row.manifest,row.revision,now,actor)).filter(d=>allowed.has(d.requestId))};
}
function controlResult(prior,replayed){const event=typeof prior.event_json==='string'?JSON.parse(prior.event_json):prior.event;return {replayed,event:{id:event.id,revision:event.revision,actor:event.actor,type:event.type,result:event.result},eventHash:prior.hash};}
export async function commitControl(db,command,actor,now){if(command?.type==='treasury')controlError('CANONICAL_TREASURY_ROUTE_REQUIRED',409);return commitControlEvent(db,command,actor,now);}
export async function commitTreasuryControl(db,command,actor,now){if(command?.type!=='treasury')controlError('INVALID_TREASURY_COMMAND',400);return commitControlEvent(db,command,actor,now);}
async function commitControlEvent(db,command,actor,now){
  try{command=JSON.parse(stable(command));}catch{controlError('INVALID_CANONICAL_VALUE',400);}
  if(!command||typeof command.id!=='string'||!Number.isSafeInteger(command.expectedRevision))controlError('INVALID_COMMAND',400);
  const commandHash=await controlHash(command),prior=await db.prepare('SELECT actor,command_hash,event_json,hash FROM numina_control_events WHERE id=?').bind(command.id).first();
  if(prior){if(prior.actor!==actor||prior.command_hash!==commandHash)controlError('IDEMPOTENCY_CONFLICT',409);return controlResult(prior,true);}
  const row=await readControl(db);
  if(!Number.isSafeInteger(row.revision+1))controlError('REVISION_OUT_OF_RANGE',409);
  if(command.type==='treasury'&&command.data?.expectedHead!==row.head_hash)controlError('STALE_TREASURY_HEAD',409);
  const reduced=await reduceControl(row.manifest,command,actor,row.revision,now),manifestHash=await controlHash(reduced.manifest);
  const event={id:command.id,revision:row.revision+1,actor,at:now,type:command.type,command,commandHash,previous:row.head_hash,manifestHash,parents:reduced.parents,result:reduced.result,decisionsHash:await controlHash(reduced.decisions)};const hash=await controlHash(event);
  const validUntil=Math.min(now+5,...row.manifest.grants.filter(g=>g.expiresAt>now).map(g=>g.expiresAt),...row.manifest.evidence.filter(e=>e.expiresAt>now).map(e=>e.expiresAt),...(row.manifest.frontier?.policies||[]).filter(p=>p.expiresAt>now).map(p=>p.expiresAt),...(row.manifest.frontier?.approvals||[]).filter(a=>a.expiresAt>now).map(a=>a.expiresAt));
  let failure;try{await db.batch([
    db.prepare('UPDATE numina_control_manifest SET revision=?,manifest_json=?,manifest_hash=?,head_hash=?,mutation_id=? WHERE id=1 AND revision=? AND head_hash=? AND ? > unixepoch()').bind(event.revision,stable(reduced.manifest),manifestHash,hash,command.id,row.revision,row.head_hash,validUntil),
    db.prepare('INSERT INTO numina_control_events(id,revision,actor,command_hash,event_json,hash) SELECT ?,?,?,?,?,? FROM numina_control_manifest WHERE id=1 AND mutation_id=? AND head_hash=? AND NOT EXISTS(SELECT 1 FROM numina_control_events WHERE id=?)').bind(command.id,event.revision,actor,commandHash,stable(event),hash,command.id,hash,command.id)
  ]);}catch(e){failure=e;}
  const persisted=await db.prepare('SELECT actor,command_hash,event_json,hash FROM numina_control_events WHERE id=?').bind(command.id).first();
  if(persisted){if(persisted.actor!==actor||persisted.command_hash!==commandHash)controlError('IDEMPOTENCY_CONFLICT',409);return controlResult(persisted,persisted.hash!==hash);}
  if(failure)throw failure;controlError('STALE_REVISION',409);
}
