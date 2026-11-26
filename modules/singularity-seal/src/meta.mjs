/**
 * Copyright (c) 2026 Samuel J. Kott and SK Consulting LLC dba Numina Labs
 * Author: Samuel J. Kott
 * Operator: SK Consulting LLC dba Numina Labs
 * License: BSD-3-Clause (see ../LICENSE.md)
 */

export const VERSION = '1.0.0';
export const AUTHOR = 'Samuel J. Kott';
export const OPERATOR = 'SK Consulting LLC dba Numina Labs';
export const COPYRIGHT = 'Copyright (c) 2026 Samuel J. Kott and SK Consulting LLC dba Numina Labs';
export const LICENSE = 'BSD-3-Clause';
export const NOBLE_VERSION = '0.7.1';
export const SUITE = 'COMPSIG-MLDSA65-Ed25519-SHA512';
export const SUITE_OID = '1.3.6.1.5.5.7.6.48';
export const SUITE_OID_NAME = 'id-MLDSA65-Ed25519-SHA512';
export const LEGACY_SUITE = 'Ed25519';
export const LEGACY_OID = '1.3.101.112';
export const ARCHIVE_SUITE = 'ML-DSA-65';
export const ML_DSA_OID = '2.16.840.1.101.3.4.3.18';

export const PREFIX_ASCII = 'CompositeAlgorithmSignatures2025';
export const LABEL_ASCII = 'COMPSIG-MLDSA65-Ed25519-SHA512';

export const ML_DSA_PUBLIC_BYTES = 1952;
export const ML_DSA_SIGNATURE_BYTES = 3309;
export const ML_DSA_SEED_BYTES = 32;
export const ED25519_PUBLIC_BYTES = 32;
export const ED25519_SIGNATURE_BYTES = 64;
export const ED25519_SEED_BYTES = 32;
export const COMPOSITE_PUBLIC_BYTES = ML_DSA_PUBLIC_BYTES + ED25519_PUBLIC_BYTES;
export const COMPOSITE_SIGNATURE_BYTES = ML_DSA_SIGNATURE_BYTES + ED25519_SIGNATURE_BYTES;

export const OBJECTS = Object.freeze({
  'task-envelope': Object.freeze({
    objectType: 'task-envelope',
    ctx: 'singularity/task-envelope/v1',
  }),
  'provenance-record': Object.freeze({
    objectType: 'provenance-record',
    ctx: 'singularity/provenance-record/v1',
  }),
  'governance-policy': Object.freeze({
    objectType: 'governance-policy',
    ctx: 'singularity/governance-policy/v1',
  }),
  'archive-seal': Object.freeze({
    objectType: 'archive-seal',
    ctx: 'singularity/archive-seal/v1',
  }),
});

export function versionText() {
  return [
    `singularity-seal ${VERSION}`,
    'Envelope Seal and Archive Seal',
    COPYRIGHT,
    `Author: ${AUTHOR}`,
    `Operator: ${OPERATOR}`,
    `License: ${LICENSE}`,
    `ML-DSA: @noble/post-quantum ${NOBLE_VERSION} (FIPS 204 ML-DSA-65)`,
    'Ed25519: Node.js crypto (RFC 8032 pure Ed25519)',
    `Composite: RFC 10073 ${SUITE_OID_NAME} (${SUITE_OID})`,
  ].join('\n');
}
