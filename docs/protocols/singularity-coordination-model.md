# First read

**Precedence.** This document is the topmost layer. Read it first each day. Everything else builds underneath it.

**Aliases.** Otter Rafting Protocol, Singularity Protocol, and Singularity Coordination Model.

**Protocol body SHA-256:** `949d22cb92f40c2c16b6a72850fe0a75bb36434059ac898d42a38b3078c0fc04`

<!-- protocol-body -->
# Singularity Coordination Model

Like otters holding hands, every agent stays connected without losing its independence.

That’s the idea behind Singularity, the coordination model I’m developing at Numina Labs.

As AI agents work together, each needs to retain its own identity, authority, and accountability. Shared work should leave evidence that others can independently check.

Our design brings these principles together:

- Independent identity: each agent remains identifiable, with defined permissions.
- Ed25519 verification: digital signatures help verify who signed specific data and whether it changed. Authorization still requires separate checks.
- Evidence and provenance: claims stay connected to their supporting records.
- Zero Trust: participation alone never grants authority.
- Multi-signature governance: decisions require the independent approvals defined by policy.

The proposed Singularity Task Envelope organizes coordination around six components: identity, topology, task, evidence, signatures, and protocol versioning. In everyday terms: who is involved, how they connect, what they are doing, and what can be verified.

This application-level design is separate from our published pair-binding Internet-Draft, which proposes associating two fixed software-artifact commitments with attribution and revisioned claims.

Both are work in progress. The task-envelope design and operational multi-signature enforcement still require implementation and verification. The Internet-Draft is a proposal, without IETF endorsement.

The goal is simple: agents that can cooperate while preserving independent identity and verifiable accountability.
<!-- protocol-body-end -->

## Latch references

These hashes record the existing cohesion checks. They are not additional protocol rules. Each SHA-256 is the current file text with newlines as LF. The base main commit is `19997551c6c59dfa15ea2b21145b879209b7f1b3`. `AGENTS.md` includes the first-read pointer, so its hash is not the untouched main blob.

```otter-pin
{
  "mainCommit": "19997551c6c59dfa15ea2b21145b879209b7f1b3",
  "newline": "LF",
  "files": [
    {
      "path": "AGENTS.md",
      "role": "protocol-text",
      "sha256": "eac9d51f6f8dbd0e7c204f67a54605193e09b889d20e568b3a1ef2bf56c117f5"
    },
    {
      "path": "GEMINI.md",
      "role": "protocol-text",
      "sha256": "7fdef3c73b7eb5ce0c8e340f0ca2f8cde1ceda407d8afdba0e4a88b980a05a93"
    },
    {
      "path": "numina-agent-swarm/src/swarm-dispatcher.mjs",
      "role": "motto-constant",
      "sha256": "4bb9ebef6ccca16062ad38f067484ac237cf01f08a6fbef54ed54088e4cc786c"
    },
    {
      "path": "numina-agent-swarm/tests/m2-division-execution.test.mjs",
      "role": "motto-check",
      "sha256": "3c78c151473952c7a5b1d83389ea921b18748fd9b987f568ca8bc5fd0a3483db"
    },
    {
      "path": "scripts/source-alignment.mjs",
      "role": "alignment-check",
      "sha256": "bb5d675338bf545ecb634f08f0c4cfe04c04346b1758f0047bdf5dd3558548aa"
    },
    {
      "path": "scripts/build.mjs",
      "role": "runs-alignment-check",
      "sha256": "f35c83f369b4db44298e08d2786607ec2d10366b86abb6068a53eaf9a74dc77b"
    },
    {
      "path": "config/numina-release.v1.json",
      "role": "release-version-record",
      "sha256": "9458c464b29f3daba6db9f4b21a7f2d8e231592557f7f8985f9c8a0590c698f3"
    },
    {
      "path": "public/runtime-contract.js",
      "role": "runtime-pin",
      "sha256": "e08012bcb52fdb4f62b22841a2583d1a72fc00b2eb3a519a3ef050e39bfaece9"
    },
    {
      "path": "tests/release-topology.test.mjs",
      "role": "version-check",
      "sha256": "01eac257ddfb7388f1d9afeffab74f237f0cd2fa07c2c60d977efd747c37fc13"
    },
    {
      "path": ".github/workflows/numina.yml",
      "role": "ci-build",
      "sha256": "a12c81a69ee89d16b434f96c1d3aaa6b87a723f06fe6755677a226f49b8e0e41"
    },
    {
      "path": ".github/workflows/deploy-cloudflare.yml",
      "role": "ci-test",
      "sha256": "e416d2530fd807de38b0b768f8d933378015b73f80775b5744179f9bbcec3978"
    },
    {
      "path": ".github/workflows/verify-root-numina.yml",
      "role": "ci-build",
      "sha256": "65ea921352c80f85bda31331e58b298af96b92d354516223dbd7118464771d31"
    }
  ]
}
```

`scripts/build.mjs` runs `scripts/source-alignment.mjs` and then `scripts/sync-application-release-pin.mjs --write`. `.github/workflows/numina.yml` and `.github/workflows/verify-root-numina.yml` run `npm run build` and then `node scripts/sync-application-release-pin.mjs`. `.github/workflows/deploy-cloudflare.yml` runs that pin check and `npm test`.

`scripts/source-alignment.mjs` stops when the application version in `package.json` differs from `src/frontier.js`, `src/app-core.js`, `integrations/numina/package.json`, `integrations/numina/distribution.json`, `integrations/numina/verification.json`, `integrations/numina/file-manifest.json`, `integrations/codex/numina/.codex-plugin/plugin.json`, the Android `versionName`, the iOS `MARKETING_VERSION`, `docs/native-package-record-vN.json`, `runtime/vercel-production/package.json`, or the MCP `serverInfo` version. It also requires the Android `versionCode` to match that native record, and the iOS project version to match `scripts/ios-release.mjs`.

It requires `public/architecture-layers.js` and `config/numina-architecture.json` to carry the same frontier layers, release identity, and treasury contract fields it checks. It requires `public/runtime-contract.js`, `public/treasury-proof.js`, and `public/treasury-valuation.js` to match their copies under `integrations/numina/src/`. It requires the frozen-core manifest root to match `EXPECTED_RELEASE` in `public/runtime-contract.js`. It requires the denomination policy on the architecture, `public/business-core.json`, and the integration distribution to match `public/treasury-valuation.js`. It requires the ownership notices at the repository root to match the copies it lists.

`tests/release-topology.test.mjs` requires `config/numina-release.v1.json` to match the application version, core version, runtime version, and Node version it reads from the packages, `.nvmrc`, `public/runtime-contract.js`, the iOS build number, the Android version code, and the `/v5/release/manifest` route in `src/worker.js`. It also requires `config/numina-topology.v1.json` to share that release contract, and `wrangler.jsonc` to route `numinalabs.xyz/*` and `www.numinalabs.xyz/*`.
