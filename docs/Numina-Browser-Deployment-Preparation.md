# Prepare the 500T NUSD request in Numina

Open `/deployment-readiness`. The owner-selected recipient is `0x1a45671AE2ee3E52264116151924FAAcb80Fc02E`. This is a request selection, not evidence of wallet control, NUSD acceptance or funds. The transaction sender is intentionally empty until explicitly entered.

## Prepare and save

1. Confirm the recipient. The initial supply is 500,000,000,000,000 NUSD, with six decimals: `500000000000000000000` base units. The reviewed v3 contract has no configurable cap and remains bounded by uint256. Deployment would issue that amount and finish paused.
2. Select **Prepare unsigned deployment**. The browser loads the public artifact, source and issuer policy, checks their SHA-256 hashes, and encodes all eight constructor arguments. It preserves the four distinct role addresses, 86,400-second administrator delay and policy hash.
3. Select **Download unsigned review**. The JSON includes the recipient request, constructor bytes and hashes, unresolved review records and a local input draft. Constructor bytes alone are not a complete transaction.
4. To include an unsigned transaction draft, enter all nine working inputs: recipient, sender, chain ID, genesis block hash, nonce, maximum total fee, gas limit, gas price and fee asset label. Obtain network, nonce and fee values from the actual intended network. This page supplies no estimate or verification. It supports legacy gas pricing only, permits zero gas price, and rejects a calculated maximum charge above the specified budget.
5. **Save local draft** preserves all nine inputs; **Open local draft** accepts both the older six-field v1 draft and the current v2 draft. Imports discard approval flags, transaction data and unknown fields. The review bundle embeds a local draft but is not itself a draft-import file.

Changing an input, importing, clearing, refreshing status or leaving the page invalidates the prepared download. Values stay in memory until saved locally. Reloading starts again with the published recipient selection; it does not restore a previous draft.

The chain ID must match the pinned Numina request (`962421430`). Nonces are limited to `9007199254740991` for compatibility with the pinned verification tools. Public asset loading has a 15-second deadline and a 2 MB per-file limit.

## Review the file

The selected recipient produces 10,746 creation bytes with SHA-256 `6d16a0ac9b854dc7e28914088e28193b1896201cddd0f48b5069c35f35793202`, matching the existing offline preparation tools. A different recipient changes the encoding and digest.

The transaction draft contains only unsigned public fields. Its `draftSha256` is the SHA-256 of the canonical, recursively key-sorted JSON object before that digest field is added. Network genesis, fee asset label and budget are review metadata. Ethereum transaction data alone does not bind a genesis hash. Independently confirm the wallet's network before signing.

Every export retains `productionReady: false`, `reviewEvidenceVerified: false`, `signed: false`, `broadcast: false` and `receipt: null`. User entries cannot approve reviews, prove reserves, establish USD/USDC conversion, or record financial completion. The published 36 requirements remain pending until actual evidence resolves them.

This feature has no signing, wallet connection, transaction submission, treasury write or provider deposit operation. It fetches only public files and does not upload working inputs. No private key, password or RPC credential belongs in the preparation form. The separate local-wallet feature retains its own encrypted-backup flow.

Continue with the independent reviews and owner-wallet signing sequence in `Numina-500T-Deployment-Sequence.md`. Keep actual deployment, mint, conversion and deposit receipts separate. Review the browser-prepared constructor independently with the matching eight-argument v3 offline tools before use.
