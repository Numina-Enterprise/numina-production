import {mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateKeyPairSync, randomBytes, createHash} from 'node:crypto';
import {CaseStore} from '../../../local/compliance/lib/store.mjs';
import {loadSigners, SIGNER_LABEL} from '../../../local/compliance/lib/signoff-core.mjs';

export const FIXTURES = new URL('../fixtures/', import.meta.url);

/** Throwaway data dir, AES key and Ed25519 signer registry. Never touches the real data dir or keys. */
export function tempEnv({withLists = false} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'numina-compliance-test-'));
  const {privateKey, publicKey} = generateKeyPairSync('ed25519');
  const signersFile = join(dir, 'signers.json');
  writeFileSync(signersFile, JSON.stringify({signers: [{label: SIGNER_LABEL, publicKeyPem: publicKey.export({type: 'spki', format: 'pem'})}]}));
  const keyFile = join(dir, 'throwaway-signer.private.pem');
  writeFileSync(keyFile, privateKey.export({type: 'pkcs8', format: 'pem'}), {mode: 0o600});
  const env = {NUMINA_COMPLIANCE_DATA_DIR: join(dir, 'data'), NUMINA_COMPLIANCE_KEY: randomBytes(32).toString('base64'), NUMINA_COMPLIANCE_SIGNERS: signersFile, NUMINA_WATCHMAN_URL: 'http://127.0.0.1:9'};
  if (withLists) installFixtureLists(env);
  return {dir, env, privateKey, publicKey, keyFile, signersFile,
    store: () => new CaseStore({env, signers: loadSigners(env)}),
    cleanup: () => rmSync(dir, {recursive: true, force: true})};
}

export function installFixtureLists(env) {
  const lists = join(env.NUMINA_COMPLIANCE_DATA_DIR, 'lists');
  mkdirSync(lists, {recursive: true});
  const roles = {'SDN.CSV': ['SDN', 'primary'], 'ALT.CSV': ['SDN', 'alt'], 'ADD.CSV': ['SDN', 'address'], 'CONS_PRIM.CSV': ['CONS', 'primary'], 'CONS_ALT.CSV': ['CONS', 'alt'], 'CONS_ADD.CSV': ['CONS', 'address']};
  const files = [];
  for (const f of readdirSync(new URL('ofac/', FIXTURES))) {
    const buf = readFileSync(new URL(`ofac/${f}`, FIXTURES));
    writeFileSync(join(lists, f), buf);
    files.push({file: f, source: roles[f][0], role: roles[f][1], sha256: createHash('sha256').update(buf).digest('hex')});
  }
  writeFileSync(join(lists, 'manifest.json'), JSON.stringify({version: 'FIXTURE@2026-11-09', fetchedAt: new Date().toISOString(), files}));
}
