import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ACTIVE_PROVENANCE_POLICY, checkActiveProvenance, isHistoricalArchivePath} from '../scripts/check-active-provenance.mjs';

const rootDir = fileURLToPath(new URL('../', import.meta.url));

function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'numina-active-provenance-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  const save = (relative, document) => {
    const filename = path.join(directory, relative);
    mkdirSync(path.dirname(filename), {recursive: true});
    writeFileSync(filename, JSON.stringify(document));
    return filename;
  };
  const active = () => ({
    treasury: {
      evidencePolicy: {...ACTIVE_PROVENANCE_POLICY},
      provider_observation_boundary: {canonical: false, sourceScoped: true, aggregated: false},
    },
  });
  return {directory, save, active};
}

test('current source and generated JSON satisfy the active provenance release gate', () => {
  const result = checkActiveProvenance({rootDir});
  assert.deepEqual(result.errors, []);
});

test('accepts an internally consistent active policy and keeps archived conflicts intact', t => {
  const {directory, save, active} = fixture(t);
  const activePath = save('NUMINA/NUMINA.json', active());
  const preClose = save('NUMINA/history/pre-v4-2026-09-27/NUMINA-FINAL.pre-close.json', {
    historicalEvidenceRewritten: false,
    rawExternalSourceEvidencePreserved: true,
  });
  const laterConflict = save('NUMINA/history/pre-v4-2026-09-27/NUMINA-ROOT.json', {
    historicalEvidenceRewritten: true,
    rawExternalSourceEvidencePreserved: false,
    providerObservationsCanonical: true,
    rewritePerformed: true,
  });
  const sha256 = filename => createHash('sha256').update(readFileSync(filename)).digest('hex');
  const originalHashes = [preClose, laterConflict].map(sha256);
  assert.equal(isHistoricalArchivePath('NUMINA/history/pre-v4-2026-09-27/NUMINA-ROOT.json'), true);
  assert.equal(isHistoricalArchivePath('NUMINA/NUMINA.json'), false);
  const result = checkActiveProvenance({rootDir: directory, activeArtifactPath: activePath});
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.skippedHistorical, ['NUMINA/history']);
  assert.deepEqual([preClose, laterConflict].map(sha256), originalHashes);
});

for (const [field, correct] of Object.entries(ACTIVE_PROVENANCE_POLICY)) {
  test(`rejects contradictory nested ${field}`, t => {
    const {directory, save, active} = fixture(t);
    const document = active();
    document.treasury.evidencePolicy[field] = !correct;
    save('NUMINA/NUMINA.json', document);
    const result = checkActiveProvenance({rootDir: directory});
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(error => error.includes(`$.treasury.evidencePolicy.${field} must be ${correct}`)));
  });
}

test('rejects a nested provider observation boundary promotion', t => {
  const {directory, save, active} = fixture(t);
  const document = active();
  document.treasury.provider_observation_boundary.canonical = true;
  document.treasury.provider_observation_boundary.sourceScoped = false;
  save('NUMINA/NUMINA.json', document);
  const result = checkActiveProvenance({rootDir: directory});
  assert.ok(result.errors.some(error => error.includes('provider_observation_boundary.canonical must be false')));
  assert.ok(result.errors.some(error => error.includes('provider_observation_boundary.sourceScoped must be true')));
});

test('does not exempt a conflicting artifact merely because its filename sounds historical', t => {
  const {directory, save, active} = fixture(t);
  save('NUMINA/NUMINA.json', active());
  save('docs/NUMINA-ROOT.json', {externalProviderVerificationPromoted: true});
  const result = checkActiveProvenance({rootDir: directory});
  assert.ok(result.errors.some(error => error.includes('docs/NUMINA-ROOT.json:$.externalProviderVerificationPromoted')));
});

test('requires an explicit complete policy in the selected active artifact', t => {
  const {directory, save, active} = fixture(t);
  save('config/policy.json', active());
  const activePath = save('NUMINA/NUMINA.json', {historicalEvidencePreserved: true});
  const result = checkActiveProvenance({rootDir: directory, activeArtifactPath: activePath});
  assert.ok(result.errors.some(error => error.includes('active artifact must explicitly declare rawExternalSourceEvidencePreserved=true')));
});
