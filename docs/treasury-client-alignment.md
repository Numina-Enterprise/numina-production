# Treasury client alignment

Numina OS, the control panel, Frontier, and the integration kit read the existing canonical native treasury through `readTreasury()` at `/api/control/v1/treasury`. The account view at `/api/control/v2/treasury/accounts` derives its shared amounts from that same record. Treasury mutations continue exclusively through `writeTreasury(event)` in the existing root and journal.

`config/numina-architecture.json` binds the required architecture to Numina 4.0.0 and its retained 1.9.0-rc26 runtime. The build checks its release versions, five layers, execution contract and single treasury against the maintained software and includes the contract in `/source-alignment.json`. This contract describes required software behavior; live head, deployment and balances come from their authenticated records.

External balances are read from Stripe through `/api/control/v1/stripe-treasury`, with fresh provider requests and private, uncached responses. The adapter retains each currency and available, inbound-pending and outbound-pending bucket. A release does not write provider balances or combine them with the native projection. Bank observations remain unavailable until an authenticated bank source is connected.

The Vercel assembly forwards `/api/control/v1/*`, `/api/app/v1/*`, `/api/ops/v1/*`, application release manifests and `/source-alignment.json` to `https://numinalabs.xyz`. Its existing v2 control forwarding uses that same origin. Vercel therefore reads the canonical treasury and Stripe observation endpoints from the existing application; it does not create an environment-specific balance. Owner authentication remains required. The retained verifier continues to serve its own `/v1/*` runtime evidence.

The website and integration kit ship the same `treasury-proof.js` validator. The build rejects differences between these copies. It checks the frozen model fields, exact integer NUSD amount, root and Principal, Authority, command hash, event hash, revision, and projection binding. Frontier also checks each displayed account's canonical reference, shared amount, revision, head, and declared valuation against that record before rendering. Account references, labels, recorded policy, funding declarations, and historical events are preserved.

An older treasury event remains valid when other journal operations have advanced the head. The client checks that the event revision does not exceed the reported current revision, and binds the head directly when their revisions match. It does not reconstruct intervening ancestry; the authenticated server validates and replays the journal. Local SHA-256 consistency checks are not builder signature verification, independent source authentication, bank confirmation, or proof of reserves. The integration result retains `server_reported_not_independently_verified`.

Refreshes and loss of owner access cancel pending reads and clear private records. A late response cannot restore an obsolete treasury view. Writes are not automatically retried.

The rc26 release display also requires a production declaration that signs every displayed manifest field. An unsigned extra field or a staging declaration cannot pass the release check. The runtime's pinned identity remains unchanged.

The frozen starting projection remains 500,000,000,000,000 NUSD, Authority NUMINA, Verification VERIFIED, System of record NUMINA, within the Numina-native model. This software update performs no treasury write or account-reference mutation.
