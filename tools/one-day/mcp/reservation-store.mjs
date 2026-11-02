import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';

const text = x => typeof x === 'string' && x.length > 0 && x.length <= 1024;
const units = x => typeof x === 'string' && /^[1-9][0-9]{0,77}$/.test(x);
const fields = ['issuer','audience','operator','payer','mandateId','asset'];

// A single shared SQLite file, not a distributed database. The surrounding
// service must pin this policy from trusted configuration, never from a token.
export class ReservationStore {
  constructor(path, policy) {
    if (path === ':memory:' || !text(path) || !policy ||
      !fields.every(k => text(policy[k])) || !units(policy.limitMinor)) throw Error('DURABLE_POLICY_REQUIRED');
    this.policy = Object.freeze(Object.fromEntries([...fields,'limitMinor'].map(k => [k,policy[k]])));
    this.key = createHash('sha256').update(JSON.stringify(fields.map(k => policy[k]))).digest('hex');
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    this.db.exec(`CREATE TABLE IF NOT EXISTS mandate_budget (
      id TEXT PRIMARY KEY, policy_json TEXT NOT NULL, used_minor TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS consumed_verdict (
      issuer TEXT NOT NULL, nonce TEXT NOT NULL, jti TEXT NOT NULL,
      budget_id TEXT NOT NULL, amount_minor TEXT NOT NULL, expires_at INTEGER NOT NULL,
      PRIMARY KEY(issuer,nonce), UNIQUE(issuer,jti));`);
    const serialized=JSON.stringify(this.policy);
    this.db.prepare('INSERT INTO mandate_budget(id,policy_json,used_minor) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING').run(this.key,serialized,'0');
    if(this.db.prepare('SELECT policy_json FROM mandate_budget WHERE id=?').get(this.key).policy_json!==serialized){this.db.close();throw Error('POLICY_CHANGE_REQUIRES_REVIEW');}
    this.durability='PERSISTENT_ATOMIC';
  }
  async commit(input) {
    if (!input || !fields.every(k=>input[k]===this.policy[k]) ||
      !text(input.nonce) || !text(input.jti) || !units(input.amountMinor) ||
      !Number.isSafeInteger(input.expiresAt) || input.expiresAt<=Math.floor(Date.now()/1000)) return false;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const replay=this.db.prepare('SELECT 1 FROM consumed_verdict WHERE issuer=? AND (nonce=? OR jti=?)').get(input.issuer,input.nonce,input.jti);
      const row=this.db.prepare('SELECT used_minor,policy_json FROM mandate_budget WHERE id=?').get(this.key);
      if (!row || row.policy_json!==JSON.stringify(this.policy) || replay ||
        BigInt(row.used_minor)+BigInt(input.amountMinor)>BigInt(this.policy.limitMinor)) {
        this.db.exec('ROLLBACK');return false;
      }
      const used=(BigInt(row.used_minor)+BigInt(input.amountMinor)).toString();
      this.db.prepare('INSERT INTO consumed_verdict(issuer,nonce,jti,budget_id,amount_minor,expires_at) VALUES(?,?,?,?,?,?)').run(input.issuer,input.nonce,input.jti,this.key,input.amountMinor,input.expiresAt);
      this.db.prepare('UPDATE mandate_budget SET used_minor=? WHERE id=?').run(used,this.key);
      this.db.exec('COMMIT');return true;
    } catch(error) { try{this.db.exec('ROLLBACK');}catch{}throw error; }
  }
  snapshot() {
    const row=this.db.prepare('SELECT used_minor FROM mandate_budget WHERE id=?').get(this.key);
    return {usedMinor:row.used_minor,limitMinor:this.policy.limitMinor,
      consumed:this.db.prepare('SELECT COUNT(*) AS n FROM consumed_verdict WHERE budget_id=?').get(this.key).n};
  }
  close(){this.db.close();}
}
