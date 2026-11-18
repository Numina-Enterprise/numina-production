// numina-compliance-manifest.js — SHA256SUMS manifests with detached
// dual (Ed25519 + ML-DSA-65) signatures for compliance artifacts.
//
// WHAT THIS IS
//   A manifest generator + verifier for compliance artifacts, telemetry,
//   and schema reports. Given a list of artifact files it emits a
//   SHA256SUMS.txt in standard `sha256sum` format, and it verifies such a
//   manifest by recomputing every file's SHA-256. The manifest's integrity
//   proof is a detached JSON sidecar (SHA256SUMS.txt.sig.json) holding one
//   hybrid signature per role (Authority and Guardian), each hybrid
//   signature being Ed25519 AND ML-DSA-65 over the SAME RFC 8785 canonical
//   bytes of { schema, manifestSha256Hex }.
//
// MANIFEST FORMAT (exact)
//   One line per artifact file:
//     <sha256-hex, lowercase, 64 chars><two spaces><relative-path><LF>
//   - Lines are sorted by relative path in BYTE order (UTF-8 byte
//     comparison, not locale or code-point order).
//   - Line endings are LF only; a CR anywhere fails verification.
//   - The text ends with exactly one trailing LF after the last line
//     (no trailing blank line). An empty file list produces an empty
//     string (no lines); an empty manifest fails verification.
//   - The two-space separator is the text-mode form, exactly as GNU
//     `sha256sum` writes it. The binary-mode form (` *path`) is NOT
//     accepted.
//   - Paths are relative to the manifest's base directory, POSIX
//     forward slashes, no leading `./`, no absolute path, no backslash,
//     no `..` segment, no empty path, no control characters.
//   - Hex is lowercase only; uppercase hex is malformed.
//
// SIGNING IS OWNER-RUN. Muse holds NO private keys. No function in this
// module signs anything: signing happens in scripts/sign-sha256sums.mjs,
// run by the owner with his own key files, and verification here uses
// ONLY the pinned public keys from the protocol config, through the
// existing hybrid verify path in src/numina-protocol-pqc.js (no new
// crypto is written here).
//
// OWNER-RUN COMMANDS (exact shapes; run from the repository root.
// Replace the key-file paths with the owner's real key locations —
// these paths are shapes, not placeholders to paste verbatim):
//
//   # 1. Generate the manifest (base directory = the artifacts directory):
//   #    (generate SHA256SUMS.txt with whatever tooling lists the artifacts;
//   #    this module's generateManifest is the reference implementation.)
//
//   # 2. Sign it with BOTH roles in one run (each role: one Ed25519 key
//   #    file AND one ML-DSA-65 PKCS#8 key file):
//   node scripts/sign-sha256sums.mjs --manifest release-evidence/SHA256SUMS.txt \
//     --authority-ed25519-key-file /path/to/authority-ed25519.key \
//     --authority-ml-dsa-65-key-file /path/to/authority-ml-dsa-65.key \
//     --guardian-ed25519-key-file /path/to/guardian-ed25519.key \
//     --guardian-ml-dsa-65-key-file /path/to/guardian-ml-dsa-65.key \
//     --out release-evidence/SHA256SUMS.txt.sig.json
//
//   #    Or sign one role at a time (run once per role; the second run
//   #    merges into the sidecar the first run wrote):
//   node scripts/sign-sha256sums.mjs --manifest release-evidence/SHA256SUMS.txt \
//     --role authority \
//     --ed25519-key-file /path/to/authority-ed25519.key \
//     --ml-dsa-65-key-file /path/to/authority-ml-dsa-65.key \
//     --out release-evidence/SHA256SUMS.txt.sig.json
//   node scripts/sign-sha256sums.mjs --manifest release-evidence/SHA256SUMS.txt \
//     --role guardian \
//     --ed25519-key-file /path/to/guardian-ed25519.key \
//     --ml-dsa-65-key-file /path/to/guardian-ml-dsa-65.key \
//     --out release-evidence/SHA256SUMS.txt.sig.json
//
//   # 3. Verify manifest + both roles' dual signatures (exit 0 only when
//   #    every file hash and both hybrid signatures verify):
//   node scripts/verify-sha256sums.mjs \
//     --manifest release-evidence/SHA256SUMS.txt \
//     --signatures release-evidence/SHA256SUMS.txt.sig.json \
//     --base-dir release-evidence
//
// VERIFICATION IS FAIL-CLOSED, everywhere:
//   - a missing file, a hash mismatch, a malformed line, a duplicate
//     path, or unsorted lines each fail verifyManifest;
//   - a bad Ed25519 part OR a bad ML-DSA-65 part fails that role's
//     hybrid signature (both parts must verify over the same bytes);
//   - a signature from a key that is not pinned fails;
//   - a null/unprovisioned pinned ML-DSA-65 key fails closed — there is
//     NO Ed25519-only fallback, in this module or anywhere else.
//
// ENDIANNESS: byte layouts defined here use big-endian (the hybrid
// bundle's length prefixes are big-endian per numina-protocol-pqc.js).
// Ed25519 and ML-DSA-65 keep their standard encodings (labeled
// exceptions, never re-encoded). No new dependencies.
import { readFileSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  canonicalBytes,
  hex,
  loadProtocol,
} from './numina-protocol-verify.js';
import {
  HYBRID_SIGNATURE_SCHEMA,
  ML_DSA_65_SIGNATURE_BYTES,
  ED25519_SIGNATURE_BYTES,
  pqcPublicKeyForRole,
  verifyHybridAuthoritySignature,
  verifyHybridGuardianSignature,
} from './numina-protocol-pqc.js';

/** Sidecar schema: the detached dual-signature binding for a manifest. */
export const MANIFEST_SIGNATURE_SCHEMA = 'numina.sha256sums-manifest-signature.v1';

/** The payload both roles hybrid-sign: schema + the manifest's SHA-256. */
export const MANIFEST_SIGNATURE_PAYLOAD_SCHEMA = MANIFEST_SIGNATURE_SCHEMA;

/** One manifest line: 64 lowercase hex chars, two spaces, a path. */
export const MANIFEST_LINE_PATTERN = /^([0-9a-f]{64})  (.+)$/;

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

/** Compare two strings by their UTF-8 bytes (byte order, not locale). */
export function comparePathBytes(a, b) {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/** SHA-256 hex (lowercase) of bytes. */
export function sha256Hex(bytes) {
  return hex(sha256(bytes));
}

/** SHA-256 hex (lowercase) of a file's bytes. Throws if unreadable. */
export function hashFile(filePath) {
  return sha256Hex(readFileSync(filePath));
}

/** SHA-256 hex (lowercase) of manifest text (UTF-8 bytes). */
export function computeManifestSha256(manifestText) {
  if (typeof manifestText !== 'string') throw new Error('manifest text must be a string');
  return sha256Hex(new TextEncoder().encode(manifestText));
}

/**
 * Validate a manifest-relative path. Returns an error string, or null
 * when the path is acceptable. Rejects absolute paths, backslashes,
 * `..` segments, leading `./`, empty paths, and control characters.
 */
export function validateManifestPath(path) {
  if (typeof path !== 'string' || path.length === 0) return 'path is empty';
  if (path.startsWith('/') || path.startsWith('\\')) return 'path must be relative';
  if (path.includes('\\')) return 'path must use POSIX forward slashes';
  if (path.startsWith('./')) return 'path must not start with ./';
  if (path.split('/').includes('..')) return 'path must not contain ..';
  if (path.split('/').includes('')) return 'path must not contain an empty segment';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(path)) return 'path contains a control character';
  return null;
}

/**
 * Resolve a file path against baseDir and return its POSIX relative
 * path. Throws when the resolved path escapes baseDir.
 */
export function toManifestPath(filePath, baseDir) {
  const base = resolve(baseDir);
  const absolute = resolve(base, filePath);
  const rel = relative(base, absolute).split(sep).join('/');
  const error = validateManifestPath(rel);
  if (error) throw new Error(`file path is not a valid manifest path: ${error} (${filePath})`);
  return rel;
}

/**
 * Generate SHA256SUMS.txt text for a list of artifact file paths.
 * Each path may be absolute or relative to baseDir (default: the
 * process working directory). Files are hashed with SHA-256 and lines
 * are emitted sorted by path byte order, LF endings, one trailing LF,
 * no trailing blank line. Throws on a missing/unreadable file or a
 * path that cannot be expressed relative to baseDir — generation never
 * silently omits a file.
 */
export function generateManifest(filePaths, { baseDir = process.cwd() } = {}) {
  if (!Array.isArray(filePaths)) throw new Error('filePaths must be an array');
  const entries = filePaths.map((filePath) => {
    const absolute = resolve(baseDir, filePath);
    const rel = toManifestPath(absolute, baseDir);
    return { path: rel, sha256: hashFile(absolute) };
  });
  entries.sort((a, b) => comparePathBytes(a.path, b.path));
  if (entries.length === 0) return '';
  return `${entries.map((entry) => `${entry.sha256}  ${entry.path}`).join('\n')}\n`;
}

/**
 * Parse manifest text strictly into [{ path, sha256 }] in file order.
 * Throws on: empty manifest, CR anywhere, missing trailing LF, a
 * trailing blank line, a blank line, a malformed line (including
 * uppercase hex, a single-space separator, or the binary ` *` form),
 * an invalid path, a duplicate path, or lines not sorted by path byte
 * order. Parsing never repairs input.
 */
export function parseManifest(manifestText) {
  if (typeof manifestText !== 'string' || manifestText.length === 0) {
    throw new Error('manifest is empty');
  }
  if (manifestText.includes('\r')) {
    throw new Error('manifest contains CR — LF endings only');
  }
  if (!manifestText.endsWith('\n')) {
    throw new Error('manifest does not end with a trailing LF');
  }
  if (manifestText.endsWith('\n\n')) {
    throw new Error('manifest ends with a blank line');
  }
  const lines = manifestText.slice(0, -1).split('\n');
  const entries = [];
  const seen = new Set();
  let previousPath = null;
  for (const line of lines) {
    if (line.length === 0) throw new Error('manifest contains a blank line');
    const match = MANIFEST_LINE_PATTERN.exec(line);
    if (!match) {
      throw new Error(`malformed manifest line: ${JSON.stringify(line)}`);
    }
    const [, expected, path] = match;
    if (path.startsWith(' ')) {
      throw new Error(`malformed manifest line (path starts with a space): ${JSON.stringify(line)}`);
    }
    const pathError = validateManifestPath(path);
    if (pathError) throw new Error(`invalid manifest path ${JSON.stringify(path)}: ${pathError}`);
    if (seen.has(path)) throw new Error(`duplicate manifest path: ${path}`);
    seen.add(path);
    if (previousPath !== null && comparePathBytes(previousPath, path) >= 0) {
      throw new Error(`manifest lines are not sorted by path byte order: ${previousPath} before ${path}`);
    }
    previousPath = path;
    entries.push({ path, sha256: expected });
  }
  return entries;
}

/**
 * Verify a manifest by recomputing every file's SHA-256 under baseDir
 * (default: the process working directory). Returns
 * { ok, failures: [{ path, expected, actual, reason }] }.
 * Fail-closed: a missing file, a hash mismatch, a malformed line, a
 * duplicate path, or unsorted lines each produce a failure; `ok` is
 * true only when every line is well-formed, sorted, unique, and every
 * file exists with the recorded hash. `expected` is the recorded hash
 * (null when the line could not be parsed); `actual` is the recomputed
 * hash (null when the file is missing or the line is malformed).
 */
export function verifyManifest(manifestText, { baseDir = process.cwd() } = {}) {
  const failures = [];
  const fail = (path, expected, actual, reason) => {
    failures.push({ path, expected, actual, reason });
  };

  if (typeof manifestText !== 'string' || manifestText.length === 0) {
    fail('', null, null, 'manifest is empty');
    return { ok: false, failures };
  }
  if (manifestText.includes('\r')) {
    fail('', null, null, 'manifest contains CR — LF endings only');
    return { ok: false, failures };
  }
  if (!manifestText.endsWith('\n')) {
    fail('', null, null, 'manifest does not end with a trailing LF');
    return { ok: false, failures };
  }
  if (manifestText.endsWith('\n\n')) {
    fail('', null, null, 'manifest ends with a blank line');
    return { ok: false, failures };
  }

  const lines = manifestText.slice(0, -1).split('\n');
  const seen = new Set();
  let previousPath = null;
  for (const line of lines) {
    if (line.length === 0) {
      fail('', null, null, 'manifest contains a blank line');
      continue;
    }
    const match = MANIFEST_LINE_PATTERN.exec(line);
    if (!match) {
      fail(line, null, null, `malformed manifest line: ${JSON.stringify(line)}`);
      continue;
    }
    const [, expected, path] = match;
    if (path.startsWith(' ')) {
      fail(path, expected, null, `malformed manifest line (path starts with a space): ${JSON.stringify(line)}`);
      continue;
    }
    const pathError = validateManifestPath(path);
    if (pathError) {
      fail(path, expected, null, `invalid manifest path: ${pathError}`);
      continue;
    }
    if (seen.has(path)) {
      fail(path, expected, null, `duplicate manifest path: ${path}`);
      continue;
    }
    seen.add(path);
    if (previousPath !== null && comparePathBytes(previousPath, path) >= 0) {
      fail(path, expected, null, `manifest lines are not sorted by path byte order: ${previousPath} before ${path}`);
    }
    previousPath = path;
    const absolute = resolve(baseDir, path);
    const base = resolve(baseDir);
    if (absolute !== base && !absolute.startsWith(`${base}${sep}`)) {
      fail(path, expected, null, 'manifest path escapes the base directory');
      continue;
    }
    let actual;
    try {
      actual = hashFile(absolute);
    } catch {
      fail(path, expected, null, 'file is missing');
      continue;
    }
    if (actual !== expected) {
      fail(path, expected, actual, 'SHA-256 mismatch');
    }
  }
  return { ok: failures.length === 0, failures };
}

/**
 * The payload both roles hybrid-sign: { schema, manifestSha256Hex }.
 * The manifest hash must be 64 lowercase hex characters.
 */
export function manifestSignaturePayload(manifestSha256Hex) {
  if (typeof manifestSha256Hex !== 'string' || !SHA256_HEX_PATTERN.test(manifestSha256Hex)) {
    throw new Error('manifestSha256Hex must be 64 lowercase hex characters');
  }
  return { schema: MANIFEST_SIGNATURE_SCHEMA, manifestSha256Hex };
}

/** Validate one role's hybrid signature record (or null = not yet signed). */
function validateHybridRecord(record, role) {
  if (record === null || record === undefined) return null;
  if (typeof record !== 'object' || Array.isArray(record)) {
    throw new Error(`${role} signature must be a hybrid signature record or null`);
  }
  if (record.schema !== undefined && record.schema !== HYBRID_SIGNATURE_SCHEMA) {
    throw new Error(`${role} signature schema must be ${HYBRID_SIGNATURE_SCHEMA}`);
  }
  if (
    typeof record.ed25519Signature !== 'string' ||
    !/^[0-9a-fA-F]+$/.test(record.ed25519Signature) ||
    record.ed25519Signature.length !== ED25519_SIGNATURE_BYTES * 2
  ) {
    throw new Error(`${role} ed25519Signature must be ${ED25519_SIGNATURE_BYTES * 2} hex characters`);
  }
  if (
    typeof record.mlDsa65Signature !== 'string' ||
    !/^[0-9a-fA-F]+$/.test(record.mlDsa65Signature) ||
    record.mlDsa65Signature.length !== ML_DSA_65_SIGNATURE_BYTES * 2
  ) {
    throw new Error(`${role} mlDsa65Signature must be ${ML_DSA_65_SIGNATURE_BYTES * 2} hex characters`);
  }
  return {
    schema: HYBRID_SIGNATURE_SCHEMA,
    ed25519Signature: record.ed25519Signature.toLowerCase(),
    mlDsa65Signature: record.mlDsa65Signature.toLowerCase(),
  };
}

/**
 * Build the detached sidecar object for a manifest hash:
 *   { schema, manifestSha256Hex, authority, guardian }
 * Each role is a hybrid signature record ({ schema, ed25519Signature,
 * mlDsa65Signature }) or null when that role has not signed yet (a
 * partial sidecar; verification of it fails closed until both roles
 * are present). Throws on a bad manifest hash or a malformed record.
 * This builds the object only — it never signs (no private keys here).
 */
export function buildManifestSignatureSidecar({ manifestSha256Hex, authority, guardian }) {
  const payload = manifestSignaturePayload(manifestSha256Hex);
  return {
    schema: payload.schema,
    manifestSha256Hex: payload.manifestSha256Hex,
    authority: validateHybridRecord(authority, 'authority'),
    guardian: validateHybridRecord(guardian, 'guardian'),
  };
}

/** Normalize one role's signature for the hybrid verify path. */
function normalizeRoleSignature(record) {
  if (record === null || record === undefined) return null;
  if (typeof record === 'string') return record; // NPQ1 bundle hex
  if (typeof record === 'object') {
    if (typeof record.bundleHex === 'string') return record.bundleHex;
    const normalized = validateHybridRecord(record, 'role');
    return normalized;
  }
  return null;
}

/**
 * Verify BOTH roles' hybrid signatures over the RFC 8785 canonical
 * bytes of { schema, manifestSha256Hex }, against the PINNED keys from
 * the protocol config (default: numina-protocol.json). `signatures`
 * may be the full sidecar ({ schema, manifestSha256Hex, authority,
 * guardian }) or just { authority, guardian }.
 *
 * Returns { authority, guardian, both, manifestSha256Hex,
 * canonicalBytesHex, provisioned: { authority, guardian },
 * sidecarSchemaOk, sidecarHashMatches }.
 *
 * Fail-closed: a missing role, a malformed record, a bad Ed25519 part,
 * a bad ML-DSA-65 part, a signature from an unpinned key, a sidecar
 * whose schema or manifest hash does not match, or a null/unprovisioned
 * pinned ML-DSA-65 key all make that role (and therefore `both`) false.
 * There is no Ed25519-only fallback. Never throws for bad input.
 */
export function verifyManifestSignatures(
  { manifestSha256Hex, signatures, protocol = loadProtocol() } = {},
) {
  const result = {
    authority: false,
    guardian: false,
    both: false,
    manifestSha256Hex: typeof manifestSha256Hex === 'string' ? manifestSha256Hex : null,
    canonicalBytesHex: null,
    provisioned: { authority: false, guardian: false },
    sidecarSchemaOk: true,
    sidecarHashMatches: true,
  };
  try {
    if (typeof manifestSha256Hex !== 'string' || !SHA256_HEX_PATTERN.test(manifestSha256Hex)) {
      result.sidecarHashMatches = false;
      return result;
    }
    const payload = manifestSignaturePayload(manifestSha256Hex);
    result.canonicalBytesHex = hex(canonicalBytes(payload));
    if (!signatures || typeof signatures !== 'object') return result;
    if (signatures.schema !== undefined && signatures.schema !== MANIFEST_SIGNATURE_SCHEMA) {
      result.sidecarSchemaOk = false;
      return result;
    }
    if (
      signatures.manifestSha256Hex !== undefined &&
      signatures.manifestSha256Hex !== manifestSha256Hex
    ) {
      result.sidecarHashMatches = false;
      return result;
    }
    result.provisioned = {
      authority: typeof pqcPublicKeyForRole('authority', protocol) === 'string',
      guardian: typeof pqcPublicKeyForRole('guardian', protocol) === 'string',
    };
    let authorityRecord;
    let guardianRecord;
    try {
      authorityRecord = normalizeRoleSignature(signatures.authority);
      guardianRecord = normalizeRoleSignature(signatures.guardian);
    } catch {
      return result;
    }
    if (authorityRecord !== null) {
      result.authority = verifyHybridAuthoritySignature(authorityRecord, payload, protocol);
    }
    if (guardianRecord !== null) {
      result.guardian = verifyHybridGuardianSignature(guardianRecord, payload, protocol);
    }
    result.both = result.authority && result.guardian;
    return result;
  } catch {
    return { ...result, authority: false, guardian: false, both: false };
  }
}

/**
 * Verify a manifest AND its detached dual signatures together.
 * Returns { ok, manifestSha256Hex, manifest, signatures } where
 * `manifest` is the verifyManifest result and `signatures` is the
 * verifyManifestSignatures result. `ok` is true only when the manifest
 * hashes verify, the sidecar names this manifest's hash, and BOTH
 * roles' hybrid signatures verify.
 */
export function verifySignedManifest(
  { manifestText, signatures, baseDir = process.cwd(), protocol = loadProtocol() } = {},
) {
  const manifest = verifyManifest(manifestText, { baseDir });
  let manifestSha256Hex = null;
  try {
    manifestSha256Hex = computeManifestSha256(manifestText);
  } catch {
    manifestSha256Hex = null;
  }
  const sigResult = verifyManifestSignatures({ manifestSha256Hex, signatures, protocol });
  const ok =
    manifest.ok &&
    manifestSha256Hex !== null &&
    sigResult.sidecarHashMatches &&
    sigResult.sidecarSchemaOk &&
    sigResult.both;
  return { ok, manifestSha256Hex, manifest, signatures: sigResult };
}
