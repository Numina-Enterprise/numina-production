# NUSD v3 review tools

These Node 24 tools match the published eight-argument uncapped 500T artifact. They prepare review data, collect read-only RPC observations and check supplied deployment evidence. They do not sign, broadcast, create wallets, change provider balances, update the application or write the native journal.

## Install and prepare

From the extracted preparation package's `tool` directory:

```sh
npm ci --omit=dev --ignore-scripts
node prepare.mjs .. --output ../review-draft.json
```

The tool reads the fixed public paths under the package root. The initial amount is exactly `500000000000000000000` base units (500T NUSD). The approved source, artifact and issuer-policy hashes are pinned in the tool. The recipient must be supplied explicitly in `requests/NuminaUSD.constructor-review.json`. With that field missing, preparation returns `BLOCKED`, writes no constructor data and exits with code 2.

After complete constructor inputs, the result is `UNSIGNED_CONSTRUCTOR_REVIEW`. This is creation bytecode for review, **not a transaction ready for submission**. It always preserves `productionReady: false`, `walletTransaction: null` and `reviewEvidenceVerified: false`. Review record presence never verifies the underlying review. Zero issuance or changed roles/policy require a separately reviewed version with new policy pins.

## Read network inputs

Fill an explicit sender in `configuration/network-observation.request.json` and review its proposed RPC and genesis pin. Authentication stays in the `NUMINA_RPC_AUTHORIZATION` environment variable; never place it in a request file or command argument. The environment value is the exact Authorization header expected by that provider.

```sh
node collect-network.mjs ../configuration/network-observation.request.json --output ../network-observation.json
```

The collector reads chain ID, genesis, a block, sender balance, pending nonce and suggested legacy gas price. If exact constructor data is supplied, it also reads a gas estimate. It rereads the block to detect a changed snapshot. It rejects chain/genesis mismatches and credential-bearing URLs. Its RPC allowlist contains no signing or sending method. Gas estimates and suggested prices are observations; the owner must still approve an explicit fee budget and confirm the network's fee asset and signing control.

## Verify a deployment result

After the owner has reviewed and signed a fully specified deployment, collect its actual raw signed transaction, final successful receipt, canonical block/head/reread, runtime code and ABI-encoded getter results from the intended RPC. Fill `configuration/receipt-verification.expected.json` and `configuration/receipt-evidence.template.json` with those records.

```sh
node verify-receipt.mjs .. ../review-draft.json ../configuration/receipt-verification.expected.json ../configuration/receipt-evidence.template.json --output ../receipt-review.json
```

The verifier checks transaction signature recovery and identity, creation data, CREATE address, fee ceiling, successful receipt, block binding, at least 12 confirmations, exact runtime with policy immutable inserted, six decimals, paused state, supply/recipient balance, policy hash, administrator/delay, four roles and the constructor mint event. There is no `cap()` call for v3. Block numbers and receipt status use canonical RPC hex quantities; the expected chain ID, nonce, fee budget and confirmation count use exact decimal strings.

Each getter observation must contain `to`, `blockHash`, exact ABI `data` and ABI-encoded `result`. Required getters: `name`, `symbol`, `decimals`, `paused`, `totalSupply`, `balanceOf(initialRecipient)`, `authorizedSupply`, `issuerPolicyHash`, `defaultAdmin`, `defaultAdminDelay`, and `hasRole` for each of the four roles.

The result is explicitly **supplied-evidence consistency only**. Consistent files can still be fabricated; obtain and independently confirm the real RPC/provider records. A passing report never updates production metadata or becomes provider funding evidence. An invalid/incomplete record returns no candidate deployment and exits with code 2.

Use only the actually confirmed NUSD address in the three dependent sheets. Official six-decimal USDC on the same chain and actual funded provider operations remain separate requirements. Each transaction needs its own owner review, signature and receipt.

## Tests

Set `NUMINA_TEST_PACKAGE_ROOT` to the extracted package root, then run:

```sh
node --test tests/tooling.test.mjs
```

Tests use mocked RPC replies and an ephemeral in-memory test wallet on synthetic chain 31337. They never call a production RPC, retain a private key or submit a transaction.
