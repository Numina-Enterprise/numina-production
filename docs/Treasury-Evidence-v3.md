# Numina treasury evidence

The owner can read a signed supporting-evidence snapshot at `GET /api/control/v2/treasury/evidence` or with `numina_treasury_evidence` on the authenticated MCP/A2A interface. The tool accepts an empty arguments object. The control room exposes the same operation as “Read signed treasury evidence.”

The server retrieves the canonical native treasury and proof, original funding plan and owner declaration, account references, a fresh authenticated Stripe observation and a bounded page of uploaded-document metadata. It checks that the journal revision and head remain unchanged during capture, hashes the source records and signs the snapshot with the existing Numina receipt key. Provider failures are represented as unavailable; document pagination is explicit. Existing events and account records are preserved.

The snapshot is issued by Numina. Its signature authenticates Numina's captured records. It is not a bank-issued confirmation. Owner statements, uploaded files, positive provider balances and denomination policies cannot alone establish a funded 500T USD allocation, reserves, settlement or redemption.

`fundingVerification.actual_funding` remains false with status `NOT_VERIFIED`. Bank of America has no authenticated observation adapter in this release. A verified bank confirmation requires an authenticated source and a settled funding record identifying the account, asset, amount and treasury allocation. Callers cannot post balances, receipts or verification flags to this read-only endpoint.
