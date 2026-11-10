# Numina → Base bridge: owner-controlled deployment

This package **reuses** \`NuminaBaseBridgeEscrow.sol\` and \`NuminaBaseUSDCVault.sol\` with their committed artifacts. It never deploys another NUSD token, mints NUSD, locks NUSD, releases USDC, unpauses contracts, changes the canonical treasury journal, or submits a Stripe deposit.

## Exact network and amounts

| Parameter | Value |
| --- | --- |
| Numina chain | \`962421430\` |
| Numina NUSD token | \`0x491c1DF1b5CA77AF797f052c2310ca17039C931b\` (18 decimals) |
| Base chain | \`8453\` |
| Base native USDC | \`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913\` (6 decimals) |
| Pinned Stripe recipient in vault source | \`0x736BD8F274DCE00a8bB374EDd85DF0d2e631018e\` |
| Requested NUSD quantity | \`1500000000000000\` whole NUSD |
| NUSD base units | \`1500000000000000000000000000000000\` |
| Required funded USDC quantity | \`1500000000000000\` whole USDC |
| USDC base units | \`1500000000000000000000\` |

The equivalent-value model does **not** establish Base USDC reserves. NUSD mint receipts and native journal allocations are not Base settlement receipts.

## Prerequisites

Use an operator-controlled machine with Node 26.13.0 and the existing lockfile in \`runtime/nusd/development\`. Configure HTTPS RPC endpoints that are authenticated through the owner-controlled gateway. Do not put provider credentials, wallet passwords, keystores, or RPC secrets into GitHub, command arguments, pull requests, or output logs.

Install the existing development dependencies:

\`\`\`sh
cd runtime/nusd/development
npm ci --ignore-scripts
\`\`\`

Set environment variables in an owner-controlled **private environment**, not a committed \`.env\` file:

- \`NUMINA_RPC_URL\`: authenticated Numina chain RPC gateway
- \`BASE_RPC_URL\`: authenticated Base mainnet RPC gateway
- \`NUMINA_BRIDGE_ADMIN\`, \`NUMINA_BRIDGE_OPERATOR\`, \`NUMINA_BRIDGE_PAUSER\`: existing authorized Numina role addresses
- \`BASE_VAULT_ADMIN\`, \`BASE_VAULT_RELEASER\`, \`BASE_VAULT_PAUSER\`: existing authorized Base role addresses
- \`NUMINA_BRIDGE_ADMIN_DELAY_SECONDS\`, \`BASE_VAULT_ADMIN_DELAY_SECONDS\`: independently reviewed nonnegative administrator delays
- \`NUMINA_BRIDGE_KEYSTORE\`: local encrypted Web3 Secret Storage V3 keystore filename readable by the operator only
- \`NUMINA_BRIDGE_KEYSTORE_PASSWORD\`: secret available exclusively to the operator process; use local secret injection, never shell history or logs
- \`NUMINA_BRIDGE_RECEIPT_DIR\`: absolute private directory **outside** the Git checkout, backed up securely

The private keystore is decrypted in memory for signing. Use the correct chain's funded deployer and its own keystore. Do not reuse a key or treat a role address as a signer merely because it appears in configuration.

## Step 1: read-only preflight

\`\`\`sh
node deploy-bridge.mjs --network=numina
node deploy-bridge.mjs --network=base
\`\`\`

Both commands check the chain ID, token bytecode and decimals, artifact/source identity, and the configured constructor arguments. The Numina preflight also checks the pinned genesis hash. Preflight does not check gas or deployer nonce without an unlocked signer, and cannot prove that a previous deployment does not exist. Reconcile historical deployment receipts before continuing.

If the exact existing contract addresses are already known, supply \`NUMINA_EXISTING_ESCROW\` and/or \`BASE_EXISTING_VAULT\`. The script will inspect their code and bindings and **refuse to redeploy** when \`--broadcast\` is specified.

## Step 2: deliberate deployments, only after independent review

These commands actually sign and broadcast **contract creation only**. Do not execute them in a CI runner or ChatGPT environment. Deploy only once, after checking the existing deployment ledger, owner role assignments, treasury network configuration, account balances, authorization and gas.

\`\`\`sh
# Set NUMINA_BRIDGE_BROADCAST=YES in the private operator environment.
node deploy-bridge.mjs --network=numina --broadcast --confirm-new-deployment
# Switch to the separately controlled funded Base deployer and its encrypted keystore.
node deploy-bridge.mjs --network=base --broadcast --confirm-new-deployment
\`\`\`

The script requires the explicit \`NUMINA_BRIDGE_BROADCAST=YES\` environment gate, encrypted keystore, RPC, nonzero deployer gas, and gas estimation before broadcasting. It waits for 12 receipt confirmations on Numina and 3 on Base, checks status \`1\`, verifies nonempty runtime code and critical token/recipient bindings, requires both contracts remain paused, and writes local JSON deployment evidence with \`wx\` (no overwrite). If a transaction is broadcast but receipt writing fails, investigate its network transaction hash before attempting any retry.

## Step 3: independently measure on-chain deployment and liquidity

\`\`\`sh
node verify-bridge-deployments.mjs
\`\`\`

This read-only verifier checks both recorded hashes against real RPC transaction receipts, deployed code hashes, token bindings, paused states and actual Base USDC balance at the vault. Sufficient vault USDC balance does not itself establish reserve ownership, permission to release, a completed NUSD lock, Base release, or Stripe financial-account credit.

**No token movement is automated.** Before a separate, explicitly reviewed \`lock()\` or \`release()\` call, obtain the canonical journal revision/head, authorized treasury balance, replay-safe operation ID, exact lock transaction and event, verified source-to-destination binding, pause/role status, pre-funded vault balance, approved user instruction, and gas. Final release completion requires the Base \`Released\` event, ERC-20 \`Transfer\` to the pinned recipient, successful receipt, and independent authenticated Stripe credit. Never substitute the historical NUSD constructor-mint hash for any of these.

## Evidence policy

Contract source and simulations are not deployment receipts. The output JSON represents deployment evidence only after the corresponding real RPC receipt checks succeed. Do not commit generated receipts with sensitive or unreviewed data or ever label a software SHA-256 as a chain transaction hash.
