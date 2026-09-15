import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Exact retained artifact bytes, including formatting. Do not regenerate or relabel this artifact.
export const TOKEN_ARTIFACT_SHA256 = 'de287e38d8cd6364ea7e9d616067c086203c1b22e1301fb5f5333b5a02a72963';
export const TOKEN_SOURCE_SHA256 = '3a118007e78ee6e455c6c51528a55b8eeb63e2ec5c294e7c71757804df0871bf';
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

/** Validate the preserved compiler artifact and exact reviewed source without compiling anything. */
export function validateTokenArtifact(artifactBytes, sourceBytes) {
  if (!(artifactBytes instanceof Uint8Array) || !(sourceBytes instanceof Uint8Array) ||
      sha256(artifactBytes) !== TOKEN_ARTIFACT_SHA256 || sha256(sourceBytes) !== TOKEN_SOURCE_SHA256) {
    throw new Error('TOKEN_ARTIFACT_MISMATCH: the pinned artifact or its exact source bytes changed');
  }
  const artifact = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(artifactBytes));
  if (artifact.schema !== 'numina.nusd.contract-candidate.v2' || artifact.contractName !== 'NuminaUSD' ||
      artifact.sourceName !== 'contracts/NuminaUSD.sol' || artifact.sourceSha256 !== TOKEN_SOURCE_SHA256 ||
      artifact.compiler !== '0.8.37+commit.f401782d.Emscripten.clang' ||
      artifact.compilerSettings?.evmVersion !== 'london' || !Array.isArray(artifact.abi) ||
      !/^0x(?:[0-9a-f]{2})+$/.test(artifact.bytecode) ||
      !/^0x(?:[0-9a-f]{2})+$/.test(artifact.deployedBytecode)) {
    throw new Error('TOKEN_ARTIFACT_INVALID: the pinned artifact has unsupported metadata');
  }
  return artifact;
}

export function loadTokenArtifact() {
  return validateTokenArtifact(fs.readFileSync(path.join(ROOT, 'artifacts/NuminaUSD.json')),
    fs.readFileSync(path.join(ROOT, 'contracts/NuminaUSD.sol')));
}
