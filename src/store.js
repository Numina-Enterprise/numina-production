export const SCHEMA = [
 'CREATE TABLE IF NOT EXISTS numina_events_v1 (event_id TEXT PRIMARY KEY, nonce TEXT NOT NULL UNIQUE, credential_hash TEXT NOT NULL, receipt_id TEXT NOT NULL UNIQUE, receipt_json TEXT NOT NULL, created_at INTEGER NOT NULL)',
 'CREATE TABLE IF NOT EXISTS numina_violations_v1 (receipt_id TEXT PRIMARY KEY, receipt_json TEXT NOT NULL, created_at INTEGER NOT NULL)',
 'CREATE TABLE IF NOT EXISTS numina_limits_v1 (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL)',
 'CREATE INDEX IF NOT EXISTS numina_limits_expiry_v1 ON numina_limits_v1(expires_at)'
];
export async function initialize(db) { if(!db)throw new Error('STORAGE_UNAVAILABLE'); await db.batch(SCHEMA.map(s=>db.prepare(s))); }
export async function rateLimit(db,ip,now) {
  const window=Math.floor(now/60), expiry=(window+1)*60;
  const sql='INSERT INTO numina_limits_v1(bucket,count,expires_at) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count';
  const rows=await db.batch([db.prepare('DELETE FROM numina_limits_v1 WHERE expires_at < ?').bind(now), db.prepare(sql).bind('global:'+window,expiry)]);
  if(rows[1].results[0].count>300)return false;
  const personal=await db.prepare(sql).bind(ip+':'+window,expiry).first();
  return personal.count<=30;
}
export async function replay(db,c) {return !!await db.prepare('SELECT event_id FROM numina_events_v1 WHERE event_id=? OR nonce=? LIMIT 1').bind(c.eventId,c.nonce).first();}
export async function commitEvent(db,c,hash,receipt,now) {
  const r=await db.prepare('INSERT INTO numina_events_v1(event_id,nonce,credential_hash,receipt_id,receipt_json,created_at) SELECT ?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM numina_events_v1)<10000 AND ? > unixepoch() ON CONFLICT DO NOTHING RETURNING event_id').bind(c.eventId,c.nonce,hash,receipt.receipt.id,JSON.stringify(receipt),now,c.expiresAt).all();
  return r.results.length===1;
}
export async function storeViolation(db,receipt,now) { const r=await db.prepare('INSERT INTO numina_violations_v1(receipt_id,receipt_json,created_at) SELECT ?,?,? WHERE (SELECT COUNT(*) FROM numina_violations_v1)<10000 RETURNING receipt_id').bind(receipt.receipt.id,JSON.stringify(receipt),now).all(); return r.results.length===1; }
export async function coverage(db) {
  const count=await db.prepare('SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN receipt_json IS NULL OR json_valid(receipt_json)=0 THEN 1 ELSE 0 END),0) AS missing FROM numina_events_v1').first();
  return {scope:'demo ledger only',registeredEndpoints:['POST /api/v0.1/commit'],events:count.total,eventsWithoutReceipt:count.missing,bypassDetected:count.missing>0,assurance:'Structural receipt presence only; database-admin writes and systems outside this ledger are not covered.',externalExecution:'disabled',constitutionalConformance:'pending frozen C1-C14 source'};
}
