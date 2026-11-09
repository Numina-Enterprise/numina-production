// Human sign-off orchestration: show the full compliance output, confirm, sign with Ed25519, verify, finalize.
import {createSignoff, verifySignoff, loadPrivateKey, SIGNER_LABEL} from './signoff-core.mjs';
import {approvalBlockers} from './workflow.mjs';
import {buildPacket} from './packet.mjs';
import {appendAudit} from './audit.mjs';
import {loadConfig, sha256Hex, canonicalJson} from './util.mjs';

const TARGET = {approve: 'approved', clear: 'cleared', reject: 'rejected'};

/**
 * @param {{store, caseId, keyPath?, privateKey?, decision?, confirm:(packetMarkdown:string, caseId:string)=>Promise<boolean>|boolean, passphrase?, config?, now?, out?}} o
 */
export async function performSignoff(o) {
  const {store, caseId, confirm} = o;
  const config = o.config ?? loadConfig();
  const out = o.out ?? (() => {});
  const c = store.get(caseId);
  const decision = o.decision ?? (c.caseType === 'payment' ? 'clear' : 'approve');
  if (!TARGET[decision]) throw new Error(`unknown decision ${decision}`);
  const now = o.now ?? new Date();
  c.blockers = approvalBlockers(c, {config, now, store});
  const {markdown} = buildPacket(c, {config, now, signers: store.signers, store});
  out(markdown);
  if (decision !== 'reject' && c.blockers.length) throw new Error(`cannot ${decision}: ${c.blockers.length} blocker(s):\n - ${c.blockers.join('\n - ')}`);
  const privateKey = o.privateKey ?? loadPrivateKey(o.keyPath, o.passphrase);
  const ok = await confirm(markdown, c.id);
  if (!ok) throw new Error('sign-off not confirmed; nothing was signed');
  const record = createSignoff({caseRecord: c, decision, privateKey, signers: store.signers, label: SIGNER_LABEL, now,
    org: `${config.organization.legal_name} dba ${config.organization.dba}`});
  const v = verifySignoff(record, {signers: store.signers, caseRecord: c});
  if (!v.valid) throw new Error(`self-verification failed: ${v.problems.join('; ')}`);
  appendAudit({caseId: c.id, event: 'signoff', decision, signer: record.payload.signer, outputSha256: record.payload.outputSha256,
    signoffSha256: sha256Hex(canonicalJson(record))}, store.env);
  store.transition(c, TARGET[decision], {actor: SIGNER_LABEL, reason: `human sign-off: ${decision}`, signoff: record});
  return {record, verification: v, caseRecord: c};
}
