import fs from 'node:fs';
import path from 'node:path';
import {createHash, createPublicKey, verify} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {PINNED_RUNTIME_PUBLIC_KEY, PINNED_RUNTIME_KEY_ID, EXPECTED_RELEASE} from '/workspace/numina-production/public/runtime-contract.js';
import {canonical, verifyRuntimeReceipt} from '/workspace/numina-production/public/runtime-release-model.js';
import {verifyReleaseEnvelope} from '/workspace/numina-production/scripts/trusted-release-evidence.mjs';

// Read-only verification of existing public evidence. This script never signs.
const root = '/workspace/numina-production';
const out = '/workspace/scratch/receipt-audit-2026-10-09';
const roots = ['docs', 'release-evidence', 'public', 'runtime', 'config'];
const excluded = new Set(['node_modules', 'archive', 'vendor', 'fixtures', '.git']);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const pointerPart = value => String(value).replaceAll('~', '~0').replaceAll('/', '~1');
const bytes = Buffer.from(PINNED_RUNTIME_PUBLIC_KEY, 'base64');
if (bytes.length !== 32 || hash(bytes).slice(0, 24) !== PINNED_RUNTIME_KEY_ID) throw Error('Invalid public pin');
const entrypoint = fs.readFileSync(path.join(root, 'runtime/verifier-rc27/deploy/vercel/entrypoint.py'), 'utf8');
if (!entrypoint.includes('"NUMINA_SIGNING_PUBLIC_KEY_B64":"' + PINNED_RUNTIME_PUBLIC_KEY + '"')) throw Error('Runtime public pins disagree');
const publicKey = createPublicKey({key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), bytes]), format: 'der', type: 'spki'});
fs.mkdirSync(out, {recursive: true});
const sshString = value => {const n = Buffer.alloc(4); n.writeUInt32BE(value.length); return Buffer.concat([n, value]);};
const sshBlob = Buffer.concat([sshString(Buffer.from('ssh-ed25519')), sshString(bytes)]);
const publicLine = 'ssh-ed25519 ' + sshBlob.toString('base64') + ' numina-runtime-verification-pin\n';
fs.writeFileSync(path.join(out, 'runtime-ed25519.pub'), publicLine);
const fingerprintOutput = execFileSync('ssh-keygen', ['-lf', path.join(out, 'runtime-ed25519.pub'), '-E', 'sha256'], {encoding: 'utf8'}).trim();
const sshFingerprint = fingerprintOutput.split(/\s+/)[1];
const expectedFingerprint = 'SHA256:' + createHash('sha256').update(sshBlob).digest('base64').replace(/=+$/, '');
if (sshFingerprint !== expectedFingerprint) throw Error('Public fingerprint mismatch');

const envelopes = [], summaries = [], parseErrors = [], documents = new Map();
let scanned = 0, excludedDirectories = 0;
function snapshot(relative, data) {
  const destination = path.join(out, 'evidence', relative);
  fs.mkdirSync(path.dirname(destination), {recursive: true});
  fs.writeFileSync(destination, data);
}
function walk(value, pointer, document, relative, artifactBytes) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (value.algorithm === 'Ed25519' || value.frontierReceiptAlgorithm === 'Ed25519') {
      const required = ['artifact_type', 'key_id', 'payload', 'algorithm', 'public_key', 'signature'];
      const complete = required.every(k => Object.hasOwn(value, k));
      const base = {path: relative, json_pointer: pointer || '', artifact_sha256: hash(artifactBytes), byte_count: artifactBytes.length};
      snapshot(relative, artifactBytes);
      if (complete) envelopes.push({...base, envelope: value, document});
      else summaries.push({...base, document_observed_at: document.observedAt ?? document.verification?.verifiedAt ?? null, reported_type: value.artifact_type ?? value.artifactType ?? null, reported_key_id: value.key_id ?? value.keyId ?? null, status: 'incomplete_evidence', limitation: 'The complete signed body and signature envelope are unavailable; cryptographic verification cannot be performed.'});
    }
    for (const [key, item] of Object.entries(value)) walk(item, pointer + '/' + pointerPart(key), document, relative, artifactBytes);
  } else if (Array.isArray(value)) value.forEach((item, i) => walk(item, pointer + '/' + i, document, relative, artifactBytes));
}
function visit(directory) {
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    const location = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (excluded.has(entry.name)) {excludedDirectories++; continue;}
      visit(location);
    } else if (entry.isFile() && entry.name.endsWith('.json') && !/(?:secret|private[-_]?key|credential)/i.test(entry.name)) {
      scanned++;
      const relative = path.relative(root, location), artifactBytes = fs.readFileSync(location);
      try {
        const document = JSON.parse(artifactBytes.toString('utf8').replace(/^\uFEFF/, ''));
        documents.set(relative, {document, artifactBytes});
        walk(document, '', document, relative, artifactBytes);
      } catch (error) {parseErrors.push({path: relative, error: error.message});}
    }
  }
}
for (const directory of roots) visit(path.join(root, directory));

const results = [];
for (const record of envelopes) {
  const {envelope: e, document, ...base} = record;
  const body = {artifact_type: e.artifact_type, key_id: e.key_id, payload: e.payload};
  const canonicalBytes = Buffer.from(canonical(body), 'utf8');
  const signature = Buffer.from(e.signature, 'base64');
  const rawVerification = e.algorithm === 'Ed25519' && e.public_key === PINNED_RUNTIME_PUBLIC_KEY && e.key_id === PINNED_RUNTIME_KEY_ID && signature.length === 64 && verify(null, canonicalBytes, publicKey, signature);
  let existingVerifier = false;
  try {verifyReleaseEnvelope(e, e.artifact_type); existingVerifier = true;} catch {}
  const browserVerifier = (await verifyRuntimeReceipt(e, PINNED_RUNTIME_PUBLIC_KEY)).valid;
  const altered = structuredClone(e);
  altered.payload = {...altered.payload, receipt_audit_tamper_probe: 'modified-audit-copy'};
  const alteredBody = {artifact_type: altered.artifact_type, key_id: altered.key_id, payload: altered.payload};
  const tamperRejected = !verify(null, Buffer.from(canonical(alteredBody), 'utf8'), publicKey, signature) && !(await verifyRuntimeReceipt(altered, PINNED_RUNTIME_PUBLIC_KEY)).valid;
  const p = e.payload;
  const observation = p.transport?.substrate_observation?.observation;
  const runtimeVersion = p.production_version ?? p.runtime?.production_version ?? null;
  results.push({...base, artifact_type: e.artifact_type, key_id: e.key_id, signature_base64: e.signature,
    format: 'Numina canonical JSON Ed25519 envelope', signed_domain: e.artifact_type,
    canonical_signed_body_sha256: hash(canonicalBytes), canonical_signed_body_byte_count: canonicalBytes.length,
    canonical_payload_sha256: hash(Buffer.from(canonical(p), 'utf8')),
    verified_against_repository_pin: rawVerification, existing_node_verifier_passed: existingVerifier,
    existing_webcrypto_verifier_passed: browserVerifier, tamper_rejected: tamperRejected,
    document_observed_at: document.observedAt ?? document.verification?.verifiedAt ?? null,
    signed_claims: {schema: p.schema ?? null, runtime_version: runtimeVersion, release: p.release ?? p.runtime?.release ?? null,
      observed_at: p.observed_at ?? null, generated_at: p.generated_at ?? null, deployed: p.deployed ?? null, ready: p.ready ?? null,
      deployment_id: observation?.deployment_id ?? null, source_commit: observation?.git_commit_sha ?? null,
      application_version: p.application?.version ?? null, build_id: p.build_id ?? p.runtime?.build_id ?? null},
    current_repository_runtime_version_matches: runtimeVersion === EXPECTED_RELEASE.production_version,
    establishes_current_deployment: false,
    limitation: 'This verifies the stored signed statement. Current target state and truth of its assertions require separate matching evidence.'});
}

const unsignedPaths = ['docs/rc26-production-deployment.json', 'docs/nusd/deployment-receipt.json', 'runtime/nusd/deployment-receipt.json'];
const unsignedRecords = unsignedPaths.map(relative => {
  const {document: d, artifactBytes} = documents.get(relative);
  snapshot(relative, artifactBytes);
  return {path: relative, artifact_sha256: hash(artifactBytes), byte_count: artifactBytes.length, schema: d.schema,
    status: 'not_an_ed25519_envelope', deployment_id: d.deploymentId ?? null,
    recorded_runtime_version: d.runtimeVersion ?? null, recorded_observation_at: d.finality?.observedAt ?? null,
    recorded_chain_id: d.chainId ?? null, recorded_finality: d.finality?.status ?? null,
    limitation: 'Historical deployment/chain observation with no complete Ed25519 envelope. Chain finality is not rechecked by this audit.'};
});
const nusdMirrorsEqual = unsignedRecords[1].artifact_sha256 === unsignedRecords[2].artifact_sha256;
const nusdDifferences = [];
function compareValues(a, b, pointer = '') {
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      const next = pointer + '/' + pointerPart(key);
      if (!Object.hasOwn(a, key) || !Object.hasOwn(b, key)) nusdDifferences.push({json_pointer: next,
        docs_present: Object.hasOwn(a, key), runtime_present: Object.hasOwn(b, key), docs_value: a[key] ?? null, runtime_value: b[key] ?? null});
      else compareValues(a[key], b[key], next);
    }
  } else if (JSON.stringify(a) !== JSON.stringify(b)) nusdDifferences.push({json_pointer: pointer, docs_present: true, runtime_present: true, docs_value: a, runtime_value: b});
}
compareValues(documents.get(unsignedPaths[1]).document, documents.get(unsignedPaths[2]).document);
const settlementPath = 'runtime/nusd/settlement-receipt.json';
const settlementRecord = documents.get(settlementPath);
snapshot(settlementPath, settlementRecord.artifactBytes);
const settlementEvidence = {path: settlementPath, artifact_sha256: hash(settlementRecord.artifactBytes),
  schema: settlementRecord.document.schema, classification: 'native_declaration',
  reported_settlement: settlementRecord.document.settlement,
  limitation: 'This unsigned native declaration explicitly reports external settlement and reserves unverified; it is not independent bank/provider proof.'};
const providerReadback = JSON.parse(fs.readFileSync('/workspace/scratch/receipt-audit-provider-readback.json', 'utf8'));
const providerSnapshot = JSON.parse(fs.readFileSync('/workspace/scratch/receipt-audit-sites-observation.json', 'utf8'));
fs.writeFileSync(path.join(out, 'sites-provider-readback.json'), JSON.stringify(providerReadback, null, 2) + '\n');
fs.writeFileSync(path.join(out, 'sites-observation.json'), JSON.stringify(providerSnapshot, null, 2) + '\n');
const providerMatches = providerReadback.deployment.status === 'succeeded' && providerReadback.deployment.version_id === providerReadback.version.id && providerReadback.deployment.id === providerReadback.version.deployment_id;
const deploymentReceiptCount = results.filter(r => r.artifact_type === 'NUMINA_DEPLOYMENT_RECEIPT').length;
const report = {
  schema: 'numina.receipt-audit.v1', checked_at: new Date().toISOString(), audit_status: 'completed_with_findings',
  scope: 'Public Ed25519 release/readiness evidence and stored deployment records in the checked Numina repository, plus authenticated Sites deployment metadata.',
  trust_anchor: {source: 'public/runtime-contract.js', agreeing_source: 'runtime/verifier-rc27/deploy/vercel/entrypoint.py',
    algorithm: 'Ed25519', key_id: PINNED_RUNTIME_KEY_ID, raw_public_key_base64: PINNED_RUNTIME_PUBLIC_KEY,
    raw_public_key_sha256: hash(bytes), openssh_public_representation_fingerprint: sshFingerprint,
    scoped_role: 'Repository-pinned Numina runtime receipt verification key',
    registry_approval_verified: false, limitation: 'The separate public-key registry was unavailable. This fingerprint is a public representation of the repository runtime pin, not proof of registration, ownership or another signing role.'},
  inventory: {repository_root: root, roots, parsed_json_count: scanned - parseErrors.length, parse_errors: parseErrors,
    excluded_directory_names: [...excluded], excluded_directory_count: excludedDirectories,
    complete_ed25519_envelope_count: results.length, incomplete_summary_count: summaries.length,
    signed_deployment_receipt_count: deploymentReceiptCount, saved_sshsig_found_in_workspace_inventory: false},
  cryptographic_checks: {node_version: process.version, verifier: 'node:crypto Ed25519; existing repository Node and WebCrypto verifiers',
    framing: 'UTF-8 canonical JSON of {artifact_type,key_id,payload} with sorted object keys and compact separators',
    all_signatures_verified: results.length > 0 && results.every(r => r.verified_against_repository_pin && r.existing_node_verifier_passed && r.existing_webcrypto_verifier_passed),
    all_tamper_checks_rejected: results.length > 0 && results.every(r => r.tamper_rejected)},
  verified_envelopes: results, incomplete_evidence: summaries, unsigned_deployment_records: unsignedRecords,
  nusd_receipt_mirrors_identical: nusdMirrorsEqual, nusd_receipt_differences: nusdDifferences,
  linked_settlement_evidence: settlementEvidence,
  fresh_provider_observation: {...providerReadback, cross_record_binding_passed: providerMatches},
  deployment_receipt_status: deploymentReceiptCount ? 'requires_target_binding_check' : 'missing_from_checked_public_evidence',
  current_signed_runtime_state: 'not_observed',
  signing_custody: {operational_signature_issued: false, key_generated_or_rotated: false,
    private_key_access_checked: false, persistence_verified: false,
    state: 'unknown', limitation: 'This public verification audit does not test private-key custody or availability. No signing secrets were configured in the current managed environment observation.'},
  unresolved_gaps: [
    {condition: 'Consistent nUSD deployment receipt copies', owner: 'owner unassigned',
      missing: 'Runtime copy adds externalSettlement.declared and externalSettlement.canonicalReceipt; documentation copy lacks those fields.',
      closure: 'Reconcile the retained receipt variants against authoritative matching settlement evidence, preserving both original hashes and their histories.'},
    {condition: 'Ed25519 receipt for the intended deployment', owner: 'owner unassigned',
      missing: 'A complete signed receipt matching the target publication source, artifact digest, deployment ID and environment.',
      closure: 'Retrieve the existing signed envelope and verify its pinned signature and exact binding to Sites version 160, if that is the intended target.'},
    {condition: 'Current runtime evidence', owner: 'owner unassigned', missing: 'A fresh signed runtime response; current managed HTTP policy does not include numinalabs.xyz.',
      closure: 'Read and verify current target evidence through supported authorized access, preserving the configured proxy.'},
    {condition: 'Separate registered signing identity continuity', owner: 'owner unassigned',
      missing: 'preserve-public-signing-workflow references/public-key-registry.json and references/signing-status.md could not be read.',
      closure: 'Restore access to the registry and historical records, then compare fingerprints and receipt signing roles.'}
  ],
  limitations: ['Provider-reported archive digest was not independently recomputed from archive bytes.',
    'Sites exposes no separate current live version ID; latest saved version 160 has a succeeded publication.',
    'Unsigned wrappers and verification summaries are outside the signature coverage unless present in the canonical signed payload.',
    'No deployment, publication, financial operation, signer replacement or private-key export was performed.'],
  next_verifiable_step: 'Obtain the existing complete signed deployment envelope for Sites version 160 (or identify the intended deployment), then verify its signature and source/artifact/deployment binding.'
};
report.audit_program = {path: 'run-receipt-audit.mjs', sha256: hash(fs.readFileSync('/workspace/scratch/run-receipt-audit.mjs')),
  exit_code_policy: 'Exit 1 for failed signature/tamper/binding checks, parse errors, or unequal nUSD receipt copies. A completed audit may retain findings.'};
fs.copyFileSync('/workspace/scratch/run-receipt-audit.mjs', path.join(out, 'run-receipt-audit.mjs'));
const reportPath = path.join(out, 'audit.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
const md = [
  'Receipt audit — 2026-10-09', '',
  `Local audit completed at ${report.checked_at}. Three stored Ed25519 envelopes were checked using the established repository runtime pin.`, '',
  `Key ID: ${PINNED_RUNTIME_KEY_ID}. Public-key OpenSSH representation fingerprint: ${sshFingerprint}.`, '',
  `Signature checks: ${report.cryptographic_checks.all_signatures_verified ? 'PASS' : 'FAIL'}. Tamper-negative checks: ${report.cryptographic_checks.all_tamper_checks_rejected ? 'PASS' : 'FAIL'}.`, '',
  '| Artifact | Signed type | Signature | Altered payload | Recorded runtime |',
  '| --- | --- | --- | --- | --- |',
  ...results.map(r => `| ${r.path} | ${r.artifact_type} | ${r.verified_against_repository_pin ? 'PASS' : 'FAIL'} | ${r.tamper_rejected ? 'Rejected' : 'FAIL'} | ${r.signed_claims.runtime_version ?? 'unknown'} |`), '',
  'The complete signed records describe rc26. The current repository expects rc27. Historical signatures remain valid; they do not prove current runtime deployment.', '',
  `${summaries.length} incomplete Ed25519 summaries cannot be signature-verified. No saved NUMINA_DEPLOYMENT_RECEIPT was found in the checked evidence. The NUSD deployment records are unsigned chain observations.`, '',
  `The documentation/runtime NUSD receipt copies are ${nusdMirrorsEqual ? 'identical' : 'different'}. ${nusdDifferences.length} parsed field differences were found; the runtime copy adds externalSettlement.declared=true and externalSettlement.canonicalReceipt=runtime/nusd/settlement-receipt.json. Their original bytes and separate hashes are retained.`, '',
  'The linked settlement receipt is an unsigned native declaration. It reports external settlement and reserves unverified, with no bank or provider receipt.', '',
  `Fresh authenticated Sites readback reports version ${providerReadback.version.version_number}, deployment ${providerReadback.deployment.id}, status ${providerReadback.deployment.status}, updated ${providerReadback.deployment.updated_at}.`, '',
  `Source commit: ${providerReadback.version.source.commit_sha}. Provider archive digest: ${providerReadback.version.archive_storage.content_hash}.`, '',
  'Those are authenticated provider records, not an Ed25519-signed deployment envelope. No production health request or archive-byte hashing was performed.', '',
  'The separate public-key registry and signing-status references were unavailable. Registry role approval and private-signer custody remain unknown. No key was generated, rotated, exported or used to sign.', '',
  'Original input snapshots, the public-key representation, provider observations and detailed hashes are retained alongside audit.json. Originals in the repository were left unchanged.', '',
  `Next verifiable step: ${report.next_verifiable_step}`, ''
].join('\n');
fs.writeFileSync(path.join(out, 'audit.md'), md);
if (parseErrors.length || !report.cryptographic_checks.all_signatures_verified || !report.cryptographic_checks.all_tamper_checks_rejected || !providerMatches || !nusdMirrorsEqual) process.exitCode = 1;
console.log(JSON.stringify({report: reportPath, audit_status: report.audit_status, parsed_json_count: report.inventory.parsed_json_count,
  complete_envelopes: results.length, incomplete_summaries: summaries.length, signatures_passed: report.cryptographic_checks.all_signatures_verified,
  tamper_checks_passed: report.cryptographic_checks.all_tamper_checks_rejected, signed_deployment_receipts: deploymentReceiptCount,
  provider_status: providerReadback.deployment.status, provider_version: providerReadback.version.version_number,
  public_fingerprint: sshFingerprint, report_sha256: hash(fs.readFileSync(reportPath))}, null, 2));
