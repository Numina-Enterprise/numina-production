# Numina v3 and rc26 production

The reconstructed Python rc26 verifier is deployed as dpl_BPA8FFKKCaWSn9EJVyWjQfZcrXz1, from source 9922f2ada9fe1b3908ee4651d2c85b16a60316b1. Its runtime build is 9045c08a5cef72d6fc5b5b15a4c46e5186a0f67f25c7bae606fe9094d122508b. The full signed descriptor is available through /v1/release/attestation.

The existing Ed25519 release identity is retained. All 105 frozen-core files match their recorded hashes. The historical 309-case report belongs to rc20 and the unchanged core; no new conformance run is claimed. SBOM and source assembly provenance match the deployed artifact contents, with no SLSA level claimed.

Evidence uses the existing PostgreSQL tables over verified TLS. The public revocation route is removed. Stored records, historical revocations and the canonical Numina journal remain intact. Evidence writes require the existing owner bearer identity through /api/control/v2/runtime-access. External handoffs remain prepared until supported authenticated execution and confirming evidence are available.

This release does not create bank funds, establish reserves, deploy an NUSD contract or complete financial settlement. The singular 500T native NUSD declaration is retained separately from confirmed provider balances. Existing Android binaries remain signed downloads; the iOS device build remains unsigned. Store review and publisher enrollment statuses remain as recorded.
