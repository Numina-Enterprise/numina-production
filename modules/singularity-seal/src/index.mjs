/**
 * Copyright (c) 2026 Samuel J. Kott and SK Consulting LLC dba Numina Labs
 * Author: Samuel J. Kott
 * Operator: SK Consulting LLC dba Numina Labs
 * License: BSD-3-Clause (see ../LICENSE.md)
 */

export { VERSION, AUTHOR, OPERATOR, COPYRIGHT, LICENSE, NOBLE_VERSION, versionText } from './meta.mjs';
export { canonicalizeJson, canonicalBytes, sha256, sha256Hex, sha512 } from './canonical.mjs';
export { messageRepresentative, signComposite, verifyComposite } from './composite.mjs';
export {
  compositeFromSeeds,
  generateCompositeKey,
  generateLegacyEd25519Key,
  publicCompositeInfo,
  loadCompositeKeyFile,
  exportCompositeKeyFile,
} from './keys.mjs';
export { loadPolicy } from './governance.mjs';
export { signEnvelope, verifyEnvelope, signGovernance, verifyGovernance } from './envelope.mjs';
export { provenanceTranscript, sealProvenance, verifyProvenanceSeal, verifyManifestEd25519 } from './provenance.mjs';
export {
  generateArchiveKey,
  archiveKeyFromSeed,
  sealArchive,
  verifyArchive,
  verifyEmbeddedEd25519,
  exportArchiveKeyFile,
  loadArchiveKeyFile,
} from './archive.mjs';
export { ed25519FromSeed, assertEd25519NotPinned, PINNED_AUTHORITY_PUBLIC_KEY_PEM, PINNED_GUARDIAN_PUBLIC_KEY_PEM, rawPublicKeyFromPem } from './ed25519.mjs';
