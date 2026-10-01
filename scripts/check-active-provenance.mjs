import {readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

export const ACTIVE_PROVENANCE_POLICY = Object.freeze({
  historicalEvidencePreserved: true,
  historicalEvidenceRewritten: false,
  rawExternalSourceEvidencePreserved: true,
  providerObservationsSourceScoped: true,
  providerObservationsCanonical: false,
  providerObservationsAggregated: false,
  externalProviderVerificationPromoted: false,
  retainSourceScopedProviderObservations: true,
  rewritePerformed: false,
  softwareAmountConflictsOverwritten: false,
  providerConfirmationRequiresIndependentEvidence: true,
});

// These names identify archived evidence by directory, never by a filename or a
// field inside a current artifact. A later conflicting record remains untouched.
const HISTORICAL_ARCHIVE_DIRECTORIES = new Set(['history', 'archive', 'archives']);
const NON_PRODUCT_DIRECTORIES = new Set(['.git', 'node_modules']);
const PROVIDER_BOUNDARY_NAMES = new Set(['provider_observation_boundary', 'providerObservationBoundary']);
const PROVIDER_BOUNDARY_POLICY = Object.freeze({canonical: false, sourceScoped: true, aggregated: false});
const ADDITIONAL_POLICY = Object.freeze({sourceScopedProviderObservationsRetained: true});

export function isHistoricalArchivePath(relativePath) {
  const parts = relativePath.replaceAll('\\', '/').split('/').slice(0, -1);
  return parts.some(part => HISTORICAL_ARCHIVE_DIRECTORIES.has(part.toLowerCase()));
}

function listCurrentJson(rootDir) {
  const files = [];
  const skippedHistorical = [];

  function visit(directory) {
    for (const entry of readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(rootDir, absolute).replaceAll('\\', '/');
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (NON_PRODUCT_DIRECTORIES.has(entry.name)) continue;
        if (HISTORICAL_ARCHIVE_DIRECTORIES.has(entry.name.toLowerCase())) {
          skippedHistorical.push(relative);
          continue;
        }
        visit(absolute);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
        files.push(absolute);
      }
    }
  }

  visit(rootDir);
  return {files, skippedHistorical};
}

function describe(value) {
  return JSON.stringify(value) ?? String(value);
}

function inspectJson(document, label, observed, errors) {
  const present = new Set();

  function visit(value, location, inProviderBoundary = false) {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${location}[${index}]`, inProviderBoundary));
      return;
    }
    if (value === null || typeof value !== 'object') return;

    for (const [key, nested] of Object.entries(value)) {
      const at = `${location}.${key}`;
      const expected = Object.hasOwn(ACTIVE_PROVENANCE_POLICY, key)
        ? ACTIVE_PROVENANCE_POLICY[key]
        : Object.hasOwn(ADDITIONAL_POLICY, key)
          ? ADDITIONAL_POLICY[key]
          : inProviderBoundary && Object.hasOwn(PROVIDER_BOUNDARY_POLICY, key)
            ? PROVIDER_BOUNDARY_POLICY[key]
            : undefined;

      if (expected !== undefined) {
        if (Object.hasOwn(ACTIVE_PROVENANCE_POLICY, key)) {
          observed.add(key);
          present.add(key);
        }
        if (nested !== expected) errors.push(`${label}:${at} must be ${expected}; found ${describe(nested)}`);
      }

      visit(nested, at, inProviderBoundary || PROVIDER_BOUNDARY_NAMES.has(key));
    }
  }

  visit(document, '$');
  return present;
}

/** Check every current product JSON file, including generated output in dist/. */
export function checkActiveProvenance({rootDir = repositoryRoot, activeArtifactPath} = {}) {
  rootDir = path.resolve(rootDir);
  const {files, skippedHistorical} = listCurrentJson(rootDir);
  const errors = [];
  const observed = new Set();
  const presentByFile = new Map();

  if (activeArtifactPath) {
    const absolute = path.resolve(activeArtifactPath);
    const relative = path.relative(rootDir, absolute).replaceAll('\\', '/');
    if (isHistoricalArchivePath(relative)) {
      errors.push(`Active artifact cannot be inside a historical archive: ${relative}`);
    } else if (!files.includes(absolute)) {
      files.push(absolute);
    }
  }

  for (const file of files.sort()) {
    const label = path.relative(rootDir, file).replaceAll('\\', '/');
    try {
      presentByFile.set(file, inspectJson(JSON.parse(readFileSync(file, 'utf8')), label, observed, errors));
    } catch (error) {
      errors.push(`${label}: cannot read valid JSON (${error.message})`);
    }
  }

  for (const key of Object.keys(ACTIVE_PROVENANCE_POLICY)) {
    if (!observed.has(key)) errors.push(`Current JSON must explicitly declare ${key}=${ACTIVE_PROVENANCE_POLICY[key]}`);
  }

  if (activeArtifactPath) {
    const absolute = path.resolve(activeArtifactPath);
    const present = presentByFile.get(absolute) ?? new Set();
    for (const key of Object.keys(ACTIVE_PROVENANCE_POLICY)) {
      if (!present.has(key)) errors.push(`${activeArtifactPath}: active artifact must explicitly declare ${key}=${ACTIVE_PROVENANCE_POLICY[key]}`);
    }
  }

  return {ok: errors.length === 0, errors, inspectedFiles: files.length, skippedHistorical};
}

function runCli() {
  let rootDir = repositoryRoot;
  let activeArtifactPath;
  for (let index = 2; index < process.argv.length; index += 1) {
    const argument = process.argv[index];
    if (argument === '--root' && process.argv[index + 1]) rootDir = process.argv[++index];
    else if (argument === '--active-artifact' && process.argv[index + 1]) activeArtifactPath = process.argv[++index];
    else throw new Error(`Unknown or incomplete argument: ${argument}`);
  }
  const result = checkActiveProvenance({rootDir, activeArtifactPath});
  if (!result.ok) {
    for (const error of result.errors) console.error(error);
    console.error(`Active provenance gate failed (${result.errors.length} errors; ${result.inspectedFiles} current JSON files inspected).`);
    process.exitCode = 1;
  } else {
    console.log(`Active provenance gate passed (${result.inspectedFiles} current JSON files inspected; ${result.skippedHistorical.length} historical archive trees preserved).`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli();
