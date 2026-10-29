# Numina owner-wallet signing controls

Open https://numinalabs.xyz/wallet-signing. The approved recipient and sender is `0x1a45671AE2ee3E52264116151924FAAcb80Fc02E`.

## Wallet created inside Numina

1. Under **Use your saved Numina wallet**, select the encrypted JSON backup you downloaded during wallet creation. It is read locally, limited to the standard Numina V3/scrypt format, and discarded after checking its public address. No password is requested; the backup is not uploaded or stored. Its public address is unencrypted metadata and does not establish key control.
2. Choose **Read Numina network estimate**. The server queries only the configured Numina node, fixed sender and exact reviewed constructor. It checks the pinned chain ID and genesis before and after estimation. The browser sends no wallet file or caller-selected transaction data.
3. Review the maximum cost and choose **Download unsigned wallet handoff**. The page refreshes the observation, verifies the exact request and constructor hashes, and checks integer fee arithmetic, freshness and observed native fee balance. Clearing the session or leaving the page discards the selection and estimate.
4. Complete the eight outstanding production reviews. Unlock the backup yourself in compatible wallet software. The backup checker does not decrypt, sign or submit. A file-format check, address match or network estimate does not resolve the reviews or independently verify funds.

The read-only route is `GET /v2/network/deployment-estimate`. It accepts no transaction input or credential selection. Quotes expire after 60 seconds. Unsigned exports retain the pending reviews, false verification/execution flags and null receipt. A 1,500T native journal projection is separate from this proposed on-chain issuance and from provider balances.

## Browser wallet extension

Use this section only with an existing compatible browser wallet extension.

1. Select that account and Numina chain `962421430` in the wallet, then choose **Connect treasury wallet**. The page checks the account, chain ID and expected genesis block. Account access is not proof that a signature has been made.
2. Choose **Read Numina gas estimate**. The provider estimates the exact 1,500T constructor and reports gas price and the selected account's native balance. Values are exact base-unit integers; no native fee symbol or NUSD gas-payment support is inferred.
3. Review the maximum network cost and choose **Download unsigned wallet handoff**. The current account and network are checked again. The estimate expires after 60 seconds and must fit the fee limit and observed balance. Account/network changes or disconnects invalidate it.
4. Complete the pending production reviews. Review the exact handoff with the wallet or signing service, including the fee asset and balance, before making the separate decision to sign and submit there. A contract deployment with this positive initial supply mints during deployment. The wallet assigns the nonce; the export does not fix one.

The preparation controls above use an existing EIP-1193 browser wallet and call only account-access and read methods. They do not create signing authority for an address or replace a wallet provider. There are no private-key, recovery-phrase or password inputs; no server receives keys. No network is added or switched automatically.

## One owner approval

The owner approved the combined release on September 16, 2026. `public/owner-approval.js` records that single authorization and binds the current 1,500T request and issuer-policy hashes. The root release manifest and owner execution policy reference the same record. Approval is recorded once across the website and gateway. The existing policy signature and supporting review evidence retain their actual verification state; submission remains blocked until those records are resolved.

The downloadable `Numina-1500T-Approval-Handoff.zip` retains its original dated evidence snapshot and checksums. The current owner approval is recorded in the release manifest, so historical evidence is not silently rewritten.

## Owner execution and receipt recovery

The **Review, confirm and track** section implements the owner wallet workflow. **This published release blocks submission**: its revised 1,500T issuer policy is unsigned and eight supporting reviews are unresolved. A checkbox, imported file, owner assertion or successful simulation cannot change that source-published gate. Resolving it requires an evidence-reviewed source release. If signing changes the issuer-policy bytes, regenerate the policy hash, exact constructor and all dependent review pins before release.

1. Sign in to the Numina owner account and connect the designated wallet. The owner-only endpoint reads any retained attempt. Reviewer accounts cannot access it.
2. Prepare the exact transaction. The wallet supplies the pending nonce, gas estimate, price and native balance on the pinned chain/genesis. Review the 1,500T amount, recipient, nonce and maximum fee. Blank maximum uses the fresh estimate. The draft expires after 60 seconds; editing the limit requires preparation again.
3. When an evidence-reviewed release enables execution, explicitly acknowledge the displayed draft and choose **Review and confirm in my wallet**. The software rechecks identity, nonce and fee, then atomically retains one owner intent before requesting one `eth_sendTransaction`. The owner makes the final decision inside the wallet. Contract creation with this positive supply mints during deployment, then remains paused.
4. A timeout, rejected wallet request or uncertain response retains the intent. There is no automatic retry, reset or second submission. Reconnect to recover the intent across tabs or devices. If necessary, enter the public hash from wallet activity; its transaction must match the retained request before it is saved. Download the record, especially if saving the hash failed.
5. Check the receipt. The verifier binds the transaction, sender, nonce, fee and exact creation data; successful receipt and derived CREATE address; at least 12 confirmations; canonical block reread; policy-bound deployed runtime; supply, recipient balance, six decimals, paused state, issuer allowance, roles and administrator delay; and the single constructor mint event. Reads use the receipt's canonical block hash. Unsupported or incomplete provider observations fail closed.

The result describes consistency of the selected provider's observations. It is not independent consensus, reserve verification, a USD/USDC conversion or a bank/Stripe deposit receipt. Neither this flow nor its retained intent modifies native treasury balances, deployment metadata, provider balances or existing PREPARED journal entries. A reported transaction hash alone is not a verified deployment.

The owner-only `GET/POST /api/control/v1/nusd-deployment` route uses existing authentication, origin protection and rate limits. Its separate table has one immutable attempt per pinned deployment and a single reportable transaction hash. Request bodies accept only compact, exact public transaction fields; they cannot inject calldata, credentials, policy approvals or provider endpoints. Migration `0004_wallet_deployment_intents` adds this table without changing existing treasury records. An unresolved attempt requires explicit operator reconciliation outside this workflow; the app does not provide an unlock route.

## Check externally submitted receipt observations

Open **Check your NUSD mint receipt** at `/wallet-signing#receipt-check` without connecting a wallet. Download the required-fields template, fill it with actual public observations from the same transaction, then paste or select the UTF-8 JSON file (maximum 2 MiB) and choose **Check receipt**. An ordinary receipt alone is insufficient: the verifier also needs the exact transaction request, canonical block and reread, latest block, deployed runtime and token-state calls. The template leaves missing observations null and does not create evidence.

This intake applies only to the pinned 1,500T constructor mint described below. It reuses the existing strict receipt verifier and exports a sanitized consistency report with the input SHA-256 and explicit execution flags. Different supply, policy, network, runtime or mint-event observations fail. Later minting, conversion and deposits require their own operation-specific checks.

The new intake performs no network request, wallet access, signing, broadcast, owner-intent write or financial mutation. Raw input is held only in this page, is cleared when leaving it, and is never included in the downloaded report. Editing, clearing or selecting another file invalidates the earlier result, including when a delayed check finishes. A passing consistency result does not independently authenticate the observations or establish funding, mint finality from an independent source, reserves or settlement. Wallet backups and known secret-material fields are rejected; provide public observations only.

## Document and transaction reference handoff

The **Create an evidence handoff** panel at `/wallet-signing#evidence-handoff` creates a local record of the owner's signing statement, an optional issuer-policy document fingerprint, and an optional public transaction hash or provider reference. It accepts PDF or UTF-8 policy documents up to 2 MiB, hashes the exact bytes, and compares them to the policy pin below. It does not validate PDF signatures or cryptographic signatures. A matching hash means the file matches the published policy bytes, including their existing verification state. A different hash requires review of the document and policy binding; changed underlying policy bytes require freshly encoded constructor and request pins before deployment.

Create one transaction-reference record for each mint, conversion or deposit. References are user supplied and remain unverified with `receipt: null`; no transaction hash or receipt is generated. A provider reference is not accepted as a Numina-chain mint hash. Owner signing statements are recorded separately with `signatureVerified: false`. File contents and filenames are omitted from the export, raw input is not uploaded or persisted, and leaving the page clears the record. The existing private supporting-document store remains available through the owner control panel. This handoff does not change the execution gate, treasury journal, contract metadata or provider balances.

The owner signing statement is separately recorded in `public/owner-approval.js` as `OWNER_REPORTED_SIGNED`. The signed-document hash remains null and signature verification remains false until the actual signed artifact is identified and checked. This statement does not change the policy or constructor pins.

## Exact separate 1,500T proposal

- Total initial supply: `1500000000000000 NUSD`, six decimals, `1500000000000000000000` base units.
- Raw constructor-review SHA-256: `ee2aaf226f9f6e843aac8f1d1ad222045db8bb3b83cd5fe23f7f2bc7c217dde8`.
- Creation data: 10,746 bytes; SHA-256 `bdaf4313f68b97d504ef3796096814d41b3002bffcf9ed75b78a939de6049401`.
- Revised issuer-policy SHA-256: `1d24f311a34a28d9560db1f32eb3efc4241701c5ae7233b97c2527006623b13d`.
- Request hash basis: raw request-file bytes, not canonical JSON.
- Expected genesis: `0xea95dac2ad854c835bc526d6be70a5a4614ccd47412a4bc710308b41010b53e1`.

The retained 500T template, policies and artifacts are unchanged. The completed 1,500T internal projection adjustment has its own journal receipt and is not an on-chain mint receipt.

The supplied fee schedule remains owner-confirmed: `0.000000000005%`, or `75 NUSD` on the separate 1,500T proposal. This schedule does not replace the wallet's RPC gas estimate, establish which asset pays gas, or deduct that fee. Quotes are single-provider observations, not independent verification or production approval. All exported execution/production-approval flags remain false and the receipt remains null.

Technical references: [EIP-1193 provider interface](https://eips.ethereum.org/EIPS/eip-1193) and [Ethereum JSON-RPC methods](https://ethereum.org/developers/docs/apis/json-rpc/).
