# NUSD minting and recipient evidence

NuminaUSD implements token minting. Its constructor can issue an explicit initial supply to one on-chain recipient within the supply cap. Later issuance uses two contract calls: the issuer authorizes a reference, recipient, amount and expiry; a distinct minter calls `mintAuthorized` for that reference. The deployed token must be unpaused, the reference unused and capacity available. Constructor issuance that fills the cap leaves no capacity for another full issuance.

## Prepare unsigned calls

Fill a copy of `runtime/nusd/mint.template.json` with the deployed token address, issuer, minter, on-chain recipient, an exact decimal NUSD amount, a nonzero bytes32 evidence reference and a Unix expiry within seven days. Null template values are deliberately invalid. Bank account names and logical treasury labels cannot replace an EVM recipient address. A mixed-case address must have a valid checksum.

Run `node runtime/nusd/scripts/prepare-mint.mjs request.json --output unsigned-mint.json` from the repository. This uses the pinned compiled ABI to prepare `authorizeIssuance` and `mintAuthorized` calldata without a wallet, network connection, signature or broadcast. The output includes exact base units, input and calldata hashes, and checks that remain outstanding. An identical retry preserves the existing file; a changed request cannot overwrite it.

The owner reviews current token identity, chain, roles, capacity, pause state, expiry, reference and recipient before using their own wallet. A reference string identifies evidence; it does not verify the evidence. The preparation tool does not unpause a contract or sign or submit a transaction.

## Inspect recipient evidence

`runtime/nusd/scripts/verify-mint-recipient.mjs` reads the configured chain and a pinned block, observes code at an explicit recipient address, and checks snapshot consistency. An optional scoped EIP-712 proof can establish that a signature matches the recipient key for that purpose and validity period. The verifier never signs or submits a transaction.

Fill `recipient-evidence.template.json` with the explicit checksummed recipient. With an authorized HTTPS endpoint configured in `NUMINA_RPC_URL`, run `node runtime/nusd/scripts/verify-mint-recipient.mjs recipient.json`. The JSON result contains the actual observation or a bounded failure result, and omits the RPC URL and credentials. A finalized-block request fails if the provider cannot supply it; the tool does not silently substitute another finality level.

For providers that require an Authorization header, configure `NUMINA_RPC_AUTHORIZATION` privately in the environment. It is sent only to the configured HTTPS endpoint and is omitted from evidence and failure results; redirects are rejected.

A chain observation or matching signature does not establish token receipt capability, a completed mint, a reserve allocation, or acceptance by Stripe or a bank. Keep those claims and their actual supporting records in the same evidence bundle with separate source references. A completed mint needs the actual confirmed transaction and matching token issuance event.

## One native treasury, asset-specific destinations

Use the [provider confirmation request](/downloads/Provider-Confirmation-Request-v4.md) to collect actual provider balance, allocation and settlement evidence. Owner approval and provider confirmation are recorded separately.

The account references remain at `/api/control/v2/treasury/accounts`, and the native journal uses only `/api/control/v1/treasury`. `PREPARE_MINT` records a `PREPARED` request and leaves the native NUSD projection unchanged. Its journal proof confirms that internal record; it is not an on-chain mint receipt.

The existing NUSD native projection, Stripe USDC destination and Bank of America USD account retain their own units and destination references. The declared 1:1 policy does not change a provider balance or make a bank account an EVM address. This release performs no treasury write, token issuance, conversion or external deposit.

Current implementation metadata is available at `/api/nusd/v1/mint-workflow`, in `/api/nusd/v1/status`, and in the current application release manifest. The application reports implemented minting separately from confirmed execution.
