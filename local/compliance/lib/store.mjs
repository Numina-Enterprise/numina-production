// Encrypted case store + status state machine. Approval/clearance only through a verified human sign-off.
import {readdirSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {writeEncrypted, readEncrypted, keyFromEnv} from './crypto-store.mjs';
import {appendAudit} from './audit.mjs';
import {verifySignoff, outputSha256} from './signoff-core.mjs';
import {dataDir, ensureDir, newId, sha256Hex, canonicalJson} from './util.mjs';

export const STATUSES = ['draft', 'submitted', 'screening', 'needs_review', 'approved', 'rejected', 'cleared'];

export const TRANSITIONS = {
  counterparty: {
    draft: ['submitted', 'rejected'],
    submitted: ['screening', 'draft', 'rejected'],
    screening: ['needs_review', 'rejected'],
    needs_review: ['approved', 'rejected', 'draft', 'screening'],
    approved: ['screening', 'rejected'],
    rejected: [],
  },
  payment: {
    needs_review: ['cleared', 'rejected', 'needs_review'],
    cleared: ['needs_review'],
    rejected: [],
  },
};
const SIGNED_STATES = {approved: 'approve', cleared: 'clear'};

export class CaseStore {
  constructor({env = process.env, key, signers} = {}) {
    this.env = env;
    this.key = key ?? keyFromEnv(env);
    this.dir = ensureDir(join(dataDir(env), 'cases'));
    this.signers = signers;
  }
  path(id) {
    if (!/^(cp|pay)_[0-9a-f]{16}$/.test(id)) throw new Error(`invalid case id: ${id}`);
    return join(this.dir, `${id}.json.enc`);
  }
  get(id) {
    const c = readEncrypted(this.path(id), this.key, id);
    if (!c) throw new Error(`case not found: ${id}`);
    return c;
  }
  has(id) { return existsSync(this.path(id)); }
  list() {
    return readdirSync(this.dir).filter((f) => f.endsWith('.json.enc')).map((f) => this.get(f.replace('.json.enc', '')));
  }
  save(c) { c.updatedAt = new Date().toISOString(); writeEncrypted(this.path(c.id), c, this.key, c.id); return c; }

  create(caseType, fields, {actor = 'local', status} = {}) {
    const id = newId(caseType === 'payment' ? 'pay' : 'cp');
    const initial = status ?? (caseType === 'payment' ? 'needs_review' : 'draft');
    const c = {id, caseType, status: initial, createdAt: new Date().toISOString(), history: [], dispositions: [], manualChecks: [], signoff: null, ...fields};
    this.save(c);
    appendAudit({caseId: id, event: 'created', caseType, to: initial, actor}, this.env);
    return c;
  }

  /**
   * Move a case to a new status. `approved` / `cleared` require a sign-off that verifies against
   * the committed public key AND the current case content; there is no other path to those states.
   */
  transition(c, to, {actor = 'local', reason = '', signoff} = {}) {
    const table = TRANSITIONS[c.caseType];
    if (!table) throw new Error(`unknown case type ${c.caseType}`);
    if (!(table[c.status] || []).includes(to)) throw new Error(`illegal transition ${c.caseType}: ${c.status} -> ${to}`);
    const wasSigned = Boolean(SIGNED_STATES[c.status]);
    if (SIGNED_STATES[to] || signoff) {
      const needed = SIGNED_STATES[to] ?? (to === 'rejected' ? 'reject' : null);
      if (!signoff) throw new Error(`${to} requires a human sign-off (npm run compliance:signoff)`);
      if (!needed) throw new Error(`a sign-off cannot authorize ${to}`);
      if (!this.signers) throw new Error('store has no signer registry; cannot verify sign-off');
      const v = verifySignoff(signoff, {signers: this.signers, caseRecord: c});
      if (!v.valid) throw new Error(`sign-off rejected: ${v.problems.join('; ')}`);
      if (signoff.payload.decision !== needed) throw new Error(`sign-off decision ${signoff.payload.decision} does not authorize ${to}`);
    }
    if (wasSigned && c.signoff) { c.history.push({supersededSignoff: c.signoff, at: new Date().toISOString()}); c.signoff = null; }
    if (signoff) c.signoff = signoff;
    const from = c.status;
    c.status = to;
    c.history.push({from, to, actor, reason, at: new Date().toISOString()});
    this.save(c);
    appendAudit({caseId: c.id, event: 'transition', from, to, actor, reasonSha256: reason ? sha256Hex(reason) : undefined,
      outputSha256: outputSha256(c), signoffSha256: signoff ? sha256Hex(canonicalJson(signoff)) : undefined}, this.env);
    return c;
  }

  /** True only when the case is approved/cleared and its sign-off still verifies against current content. */
  isEffectivelyApproved(c) {
    if (!SIGNED_STATES[c.status] || !c.signoff || !this.signers) return false;
    return verifySignoff(c.signoff, {signers: this.signers, caseRecord: c}).valid && c.signoff.payload.decision === SIGNED_STATES[c.status];
  }
}
