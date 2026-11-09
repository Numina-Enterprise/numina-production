# NUMINA multi-cloud topology reconciliation

This is a **read-only discovery harness**, not an authoritative NUMINA journal or a deployment tool. Run `python3 inventory.py` on an authorized host with already-configured `gcloud`, `aws`, `az`, and `tailscale` CLIs. It records command success, counts, and hashes rather than exporting credentials or raw account/host identifiers. No resources are changed. Output is `observations.json`.

## Authority and replication contract
- Canonical NUMINA journal and signed manifest must be supplied from the authoritative NUMINA root; GitHub and cloud provider inventories are downstream observations.
- Match each observed cloud workload to a canonical workload ID, artifact digest, source digest, environment, region, service identity, and release receipt.
- Do not promote a source commit or DNS record into a runtime attestation.
- Replication must define source of truth, direction, conflict resolution, RPO/RTO, encryption and key ownership, versioning, integrity hashes, and failover tests before activation.
- Fail closed on missing provider permissions, unknown resource identities, or unsigned journal entries.

## Evidence already observed (2026-11-07)
- Google Cloud Run `numina-production` in `us-central1`: **documented**, not live-queried.
- Porkbun `numinalabs.xyz`: active, API access disabled. Apex A `216.198.79.1`; `www` CNAME `50e4da5772431a55.vercel-dns-017.com`; wildcard CNAME `pixie.porkbun.com`. These are DNS observations, not proofs of running workloads.
- AWS, Azure, Tailscale NUMINA nodes: not yet live-inventoried.

## Next gates
1. Run read-only provider inventory with authorized credentials on a trusted NUMINA host.
2. Compare observed resources to canonical journal and manifest; classify missing, extra, drifted, or verified.
3. Validate independent signatures and artifact hashes.
4. Test replication in a non-production environment, measure lag and recovery, and document rollback.
5. Require explicit approval before changing traffic, replication or production workloads.

## Reconciliation gate (new)
`python3 reconcile.py --canonical canonical-template.json --observed observations.json --out reconciliation.json`

`reconcile.py` compares a supplied canonical workload manifest with an observed workload inventory, reporting missing, extra, duplicate, and drifted entries. It never changes resources. Its `verified_signatures` field is a caller-supplied claim, **not cryptographic verification by this utility**. Even exact field matches remain `REVIEW`, never automatically authorized for replication or deployment. The included CLI discovery output contains command statuses rather than workload entries, so it cannot prove alignment.

Run tests: `python3 -m unittest -v test_reconcile.py`.

## Frontier v3: Cloudflare, IBM Cloud, IBM Quantum and multi-cloud evidence
`reconcile_v3.py` extends the fail-closed topology policy to seven explicitly scoped providers: GCP, AWS, Azure, Cloudflare, IBM Cloud, IBM Quantum, and Tailscale. `test_reconcile_v3.py` tests the gate. It does not query provider APIs and does not cryptographically verify the claimed receipt itself. A trustworthy external verifier must produce and validate the signature receipt; its digest and trust anchor must then be independently checked. A `verified_signatures: true` boolean is not accepted as evidence.

`python3 reconcile_v3.py --canonical canonical-template.json --observed observations.json --out reconciliation-v3.json`

IBM Quantum is a research compute service, not automatically a production cloud replica. Treat quantum experiment inputs, backend IDs, calibration timestamps, job receipts, and classical baselines as separate research evidence, not replicated production state. Cloudflare DNS/proxy records likewise do not prove application workload deployment. No live replication or provider changes are made by this package.

The provider inventories and canonical manifest must be supplied from an authorized NUMINA host. Do not upload API tokens, private keys, provider credentials, or raw host secrets to the evidence bundle. Missing evidence remains BLOCKED. Even complete matching observations yield REVIEW, never automatic deployment authorization.

## Frontier v4: existing Authority key binding (2026-11-07)
Existing key ID: `skott34-ed25519`; declared authority: Samuel J. Kott (`skott34@gmail.com`); pinned SPKI SHA-256: `46b301f039fcf3fdfa7eeda9cacd9a8614c3c9e9e4e88a47f53c12fc859be8ce` (reference from downstream NUMINA repository, not independent key custody proof).

`verify_authority.py` checks an Ed25519 signature over `b'numina-manifest-v1\x00' + canonical_manifest_bytes` using the **existing public key** and requires its DER SPKI SHA-256 to match the pinned fingerprint. No new key is generated for deployment, no private key is loaded, and no signing is attempted. The unit tests generate throwaway keys only to exercise the verifier. The manifest bytes MUST already be RFC 8785 canonicalized by a trusted external canonicalizer; this script does not certify canonicalization. A successful signature check is necessary but not sufficient for release: Guardian policy, immutable artifacts, live inventories, and replication tests remain separate gates.

Example (requires genuine existing public key, canonical bytes, and signed receipt):
`python3 verify_authority.py --public-key authority-public.pem --canonical-bytes canonical-manifest.jcs --signature authority.sig --out authority-verification.json`

Run all tests: `python3 -m unittest discover -v`.

## Frontier v5: OpenSolaris/illumos compatibility adapter
`illumos_adapter.py` collects **read-only** local observations for SunOS kernel identity, Zones, ZFS/zpool, SMF, network links and FMA. It records output hashes and counts, not raw operational data, and never runs DTrace probes or modifies the host. Run it on an authorized host with `python3 illumos_adapter.py --out illumos-observation.json`. A generic `SunOS` uname string is insufficient to establish an illumos distribution, and no upstream `SunOS v6` version is asserted. Match the observation to the canonical NUMINA host manifest and independently signed release evidence before any deployment decision. `illumos_adapter.py` is **not** a cloud provider connector and does not activate cross-cloud replication.
