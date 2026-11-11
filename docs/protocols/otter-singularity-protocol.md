# Otter-Raft Singularity Protocol

## Name and daily read

This is the daily read for the cohesion pin. Its purpose is to hold the files below to one commit, so a change in any of them shows up before those files drift apart.

The repository's name for this protocol is the Otter-Raft Singularity Protocol. The words "Otter singularity protocol" do not appear in the repository. The rules below are copied from `AGENTS.md`. This file does not add rules.

## Protocol text in the repository

From `AGENTS.md` line 8, and again in section 38:

> Singularity Motto: "Like otters holding hands so they dont drift apart while resting, every agent stays connected without losing its independence. One identity. One purpose. Many coordinated agents. Singularity confirmed. NUMINA aligned."

From `AGENTS.md` section 38, "Mandatory Otter-Raft Singularity Protocol Alignment":

> - Universal Invariant: ALL agent definition files across all workspaces must embody the Otter-Raft Singularity Protocol.
> - Pinned Singularity Motto: "Like otters holding hands so they dont drift apart while resting, every agent stays connected without losing its independence. One identity. One purpose. Many coordinated agents. Singularity confirmed. NUMINA aligned."
> - Anti-Drift Handshake: Inter-agent communications maintain continuous cryptographic consensus; any state divergence triggers fail-closed quarantine.
> - Sovereign Identity: Unconditional allegiance to Authority Lead Samuel J. Kott (skott34-ed25519) and Guardian numina-guardian-ed25519.

The same motto string is the value of `OTTER_RAFT_SINGULARITY_MOTTO` in `numina-agent-swarm/src/swarm-dispatcher.mjs`. `numina-agent-swarm/tests/m2-division-execution.test.mjs` asserts that value. `GEMINI.md` repeats the motto from `AGENTS.md`.

## Pinned files

Recorded from main commit `19997551c6c59dfa15ea2b21145b879209b7f1b3`.

Each SHA-256 is the file text with newlines as LF, the bytes git stores. A later edit of one of these files fails `tests/otter-singularity-pin.test.mjs` until this list is updated.

```otter-pin
{
  "mainCommit": "19997551c6c59dfa15ea2b21145b879209b7f1b3",
  "newline": "LF",
  "files": [
    {"path": "AGENTS.md", "role": "protocol-text", "sha256": "27adae3dbcf3ca4568f791bfde065586089cd7ec1e129eacd7d74db855daa2a6"},
    {"path": "GEMINI.md", "role": "protocol-text", "sha256": "7fdef3c73b7eb5ce0c8e340f0ca2f8cde1ceda407d8afdba0e4a88b980a05a93"},
    {"path": "numina-agent-swarm/src/swarm-dispatcher.mjs", "role": "motto-constant", "sha256": "4bb9ebef6ccca16062ad38f067484ac237cf01f08a6fbef54ed54088e4cc786c"},
    {"path": "numina-agent-swarm/tests/m2-division-execution.test.mjs", "role": "motto-check", "sha256": "3c78c151473952c7a5b1d83389ea921b18748fd9b987f568ca8bc5fd0a3483db"},
    {"path": "scripts/source-alignment.mjs", "role": "alignment-check", "sha256": "bb5d675338bf545ecb634f08f0c4cfe04c04346b1758f0047bdf5dd3558548aa"},
    {"path": "scripts/build.mjs", "role": "runs-alignment-check", "sha256": "a3822885c112903e75f18c07ead12d02ff31691f0476a592cdf37133cc3fc420"},
    {"path": "config/numina-release.v1.json", "role": "release-version-record", "sha256": "9458c464b29f3daba6db9f4b21a7f2d8e231592557f7f8985f9c8a0590c698f3"},
    {"path": "public/runtime-contract.js", "role": "runtime-pin", "sha256": "e08012bcb52fdb4f62b22841a2583d1a72fc00b2eb3a519a3ef050e39bfaece9"},
    {"path": "tests/release-topology.test.mjs", "role": "version-check", "sha256": "b7b6724e1d6290dc6215fd8b497c3225ba4ee3cf7ac4d2386990db1e5973a2d3"},
    {"path": ".github/workflows/numina.yml", "role": "ci-build", "sha256": "a12c81a69ee89d16b434f96c1d3aaa6b87a723f06fe6755677a226f49b8e0e41"},
    {"path": ".github/workflows/deploy-cloudflare.yml", "role": "ci-test", "sha256": "e416d2530fd807de38b0b768f8d933378015b73f80775b5744179f9bbcec3978"},
    {"path": ".github/workflows/verify-root-numina.yml", "role": "ci-build", "sha256": "65ea921352c80f85bda31331e58b298af96b92d354516223dbd7118464771d31"}
  ]
}
```

`scripts/build.mjs` runs `scripts/source-alignment.mjs` and then `scripts/sync-application-release-pin.mjs --write`. `.github/workflows/numina.yml` and `.github/workflows/verify-root-numina.yml` run `npm run build` and then `node scripts/sync-application-release-pin.mjs`. `.github/workflows/deploy-cloudflare.yml` runs that pin check and `npm test`.

## What these checks already bind

`scripts/source-alignment.mjs` stops when the application version in `package.json` differs from `src/frontier.js`, `src/app-core.js`, `integrations/numina/package.json`, `integrations/numina/distribution.json`, `integrations/numina/verification.json`, `integrations/numina/file-manifest.json`, `integrations/codex/numina/.codex-plugin/plugin.json`, the Android `versionName`, the iOS `MARKETING_VERSION`, `docs/native-package-record-vN.json`, `runtime/vercel-production/package.json`, or the MCP `serverInfo` version. It also requires the Android `versionCode` to match that native record, and the iOS project version to match `scripts/ios-release.mjs`.

It requires `public/architecture-layers.js` and `config/numina-architecture.json` to carry the same frontier layers, release identity, and treasury contract fields it checks. It requires `public/runtime-contract.js`, `public/treasury-proof.js`, and `public/treasury-valuation.js` to match their copies under `integrations/numina/src/`. It requires the frozen-core manifest root to match `EXPECTED_RELEASE` in `public/runtime-contract.js`. It requires the denomination policy on the architecture, `public/business-core.json`, and the integration distribution to match `public/treasury-valuation.js`. It requires the ownership notices at the repository root to match the copies it lists.

`tests/release-topology.test.mjs` requires `config/numina-release.v1.json` to match the application version, core version, runtime version, and Node version it reads from the packages, `.nvmrc`, `public/runtime-contract.js`, the iOS build number, the Android version code, and the `/v5/release/manifest` route in `src/worker.js`. It also requires `config/numina-topology.v1.json` to share that release contract, and `wrangler.jsonc` to route `numinalabs.xyz/*` and `www.numinalabs.xyz/*`.
