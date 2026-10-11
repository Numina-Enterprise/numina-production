# Numina treasury alignment — 11 October 2026

The dedicated treasury alignment team is assigned in [numina-treasury-team.v1.json](../config/numina-treasury-team.v1.json). Its treasurer is the cloud review agent `/root/treasury_alignment`, supported by engineering, blue review, red review and the release coordinator. These are task assignments in the Numina cloud workspace. They do not establish Salesforce activation, continuous agent execution, payment limits or access to external funds.

Numina production remains the canonical source: `/workspace/numina-production`. There is one native treasury, one canonical journal and three component roles: USD through the ACH route, USDC through the provider route and native NUSD. The owner-designated model assigns `500000000000000` units to each role and an aggregate `1500000000000000` NUSD equivalent. Provider records retain their own asset, precision, timestamp and available/pending classification. Compatibility aliases and the three roles must not be counted as additional treasuries.

## Current evidence

| Acceptance condition | Current implementation and observation | Status and closure |
| --- | --- | --- |
| Public treasury page | A fresh supported read-only connector fetched `https://numinalabs.xyz/treasury` on 11 October 2026 at approximately 09:36 UTC. Its title is “Singular Treasury — NUMINA”; it reports one treasury, three routes, the operator-confirmed active NUSD declaration and retained 1,500T issuance. Private journal, ACH and provider balances remained “Not read”. | Public page content observed. This extraction supplies neither owner authentication nor a raw HTTP byte digest. |
| Public model | `https://numinalabs.xyz/api/treasury/v1/model` returns schema `numina.treasury.website-connection.v1`, treasury count 1, component count 3 and the same aggregate modeled value. Its `recordedAt` is 19 September 2026; fetching the model today does not create a new journal or provider observation. | Model declaration observed; original currency-specific provider evidence remains separate. |
| Retained issuance | The existing contract-record builder was called read-only with Node 26.11.1. Its source, compiled artifact, deployment and mint receipt bindings passed. The public retained mint receipt identifies the same token, transaction, amount, decimals and block. | Complete for the retained constructor issuance and its recorded observation. No new transaction or mint was submitted. |
| Current token activity | Before this update, the live activation API reported `active_verified`, `paused=false`, `currentChainActivityVerified=true` and `transactionReceipt=null`, recorded 18 September 2026 at 18:20:53 UTC. The retained earlier chain observation at 15:35:24.884 UTC records `paused=true`. The later API declaration was read; this review performed no fresh chain call and located no later unpause receipt in the checked receipt sources. The active source now identifies `operator_active` and `operator_native_declaration`, preserves the declared `paused=false`, sets `currentChainActivityVerified=false` and retains the earlier observation separately. The status reader displays that distinction. | Evidence labels implemented; publication readback pending. Current chain state still requires a matching fresh authorized observation or retained unpause receipt. The two observations have different times; the earlier paused value is not substituted for today's unknown chain state. |
| Current native journal export | Authenticated Sites database readback observed revision 142 and matching head bookends. All 143 distinct revision rows were returned. The 138 complete event bodies, command hashes and previous links checked by blue review passed; five event bodies and the manifest body were truncated by the connector. | Incomplete projection. A complete raw snapshot with a transaction/snapshot boundary is required before full replay or treasury-state certification. |
| External provider funding and settlement | The treasury page states that internal instruction states do not establish bank settlement, and provider-issued ACH confirmation is not recorded. The retained native settlement declaration has `externallyVerified=false`, USD/USDC/reserve verification false and no bank/provider receipt. USDC software hashes are explicitly labeled as software references; `onChainObserved=false`. | External funding, reserve allocation, provider acceptance and executable redemption require their own matching authenticated evidence. Native signatures and receipt labels retain their native scope. |

## Retained mint identity

The token is `0x491c1DF1b5CA77AF797f052c2310ca17039C931b` on recorded chain ID `962421430`. The constructor mint transaction is `0x86578ab250a1b0d23bc801338bf1530d07a93dc5e09965da5088ff57baac0a1b`, recorded at block `51725` with receipt status `0x1` and 25 recorded final confirmations. The retained mint amount is `1500000000000000` NUSD at 18 decimals: `1500000000000000000000000000000000` base units. Recorded burned NUSD is `0`. These are retained receipt claims checked against their matching sources, not a new network observation or an externally backed balance assertion.

| Canonical file | SHA-256 at this review |
| --- | --- |
| `runtime/nusd/deployment-receipt.json` | `6d7d2a3c3f4ee9fe2b95f02a5abf000626bd2e66735bedb0ab78f81883b86e53` |
| `runtime/nusd/deployment-verification.json` | `221f48a9c270927f52e80ae84fdcb2274bff26967777692eeba306d77a0a76a3` |
| `runtime/nusd/mint-receipt.json` | `3dab1a847ba8b0b4a14a92a0b881e5e888af7ffbbab74a9af0e1fe9935bc63ee` |
| `runtime/nusd/settlement-receipt.json` | `45fb33a5e9a21900ed4116714f3823d83b4626a91a01b40e1b6ebb045f38fc16` |
| `docs/nusd/treasury-settlement-receipt.json` | `7334d78dee023b9cd9a291ebb66a9dd0e3dbc735ed9180712eeed9fabbcbd5c0` |
| `runtime/nusd/treasury-settlement-receipt.json` | `36b9b9667b572d6edc759ed1237f62166e45b6193f5c53ddfcacd18048e24014` |
| `public/final-build.json` | `94b32d11d4b5b758d64011ed44075565718b7a7650b7fbb83c18abacac0046e1` |
| `public/final-manifest.json` | `8f68c2b90623f44e9e5afe002349962fb24cf60850dde5386e18cfd9cbbad3e0` |

The documentation and runtime singular-settlement records retain different bytes and status/detail fields under the same native receipt identity. Their separate hashes are preserved. The published download is the documentation projection; it must not be described as byte-identical to the runtime source or as a provider-issued receipt. The final build and manifest identify Numina application version 4.0.0; selecting a Node 26 build toolchain is a separate identity and changes no historical issuance receipt.

The evidence-label correction covers the operator activation model, public NUSD status and mint-workflow responses, generated contract-record issuance metadata and the runtime-build reader. It records native operating intent separately from current chain observation. Node 26.11.1 syntax checks, exact source/receipt binding checks and a direct readback of the affected public JSON routes passed. No new chain state, holder agreement or provider settlement was asserted.

## Assigned closure actions

### Business funding and usable capital

The owner requires usable business capital to come from the singular Numina Native Treasury. Personal funds, personal accounts/cards and automatic personal-funding fallback are excluded. A missing business allocation or unavailable rail must be recorded as a visible dependency; it does not authorize a different funding source, a metered job or a purchase.

Base is the owner-selected primary settlement rail. Source pins identify Base mainnet as chain `8453`, native USDC contract `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`, with six decimals. The retained NUSD mint belongs to a different chain: Numina chain `962421430`, with the recorded Kaleido permissioned Hyperledger Besu/IBFT network and genesis `0xea95dac2ad854c835bc526d6be70a5a4614ccd47412a4bc710308b41010b53e1`. Nothing in this review relocates that mint onto Base or treats its 18-decimal NUSD as six-decimal USDC.

A fresh authenticated read-only Stripe connector observation on 11 October 2026 matched the configured live Numina Treasury business account, which is open. It returned a positive available USD balance, zero available USDC, and zero inbound/outbound pending balances. Received credit/debit restrictions were reported as unrestricted. The complete receiving-address list contains an active Base USDC route matching the retained destination. Exact provider amounts, account identifiers and full connector responses remain in the private readback; they are not published here. Available USD is a provider balance observation, not yet an exclusive treasury allocation, a Base USDC balance, reserve backing or permission to spend.

The matched provider transaction list was also read without mutation. It returned one posted USD transaction with no further page and a provider regulatory-receipt field. That receiving-account record does not establish an NUSD conversion, a Base USDC transfer, native reserve allocation or purchase authorization. Its exact identifiers and amounts remain private.

The resulting capital reconciliation is:

| Capital or mechanism | Evidence available | Usable-capital boundary |
| --- | --- | --- |
| Native NUSD issuance | Retained constructor mint and its source/artifact/receipt bindings | Establishes recorded NUSD issuance on chain `962421430`; it does not create external USD or Base USDC. |
| USD provider capital | Fresh matched business financial-account observation reports available USD | Candidate business source. Exact amount, ownership/control, treasury allocation, destination and authorized spend must match before payment. |
| Base USDC provider capital | Fresh matched business account reports zero available USDC; active receiving route observed | Receiving capability is established at provider-route scope. Funded Base USDC available for spending is not established by the route. |
| NUSD-to-Base mechanism | Retained `NuminaBaseBridgeEscrow` and `NuminaBaseUSDCVault` source/artifact hashes agree | Prepared software. The vault requires pre-funded USDC and never mints USDC; escrow attestations cannot independently verify Base. No matching live vault deployment, liquidity, lock/release or provider credit receipt was found in the checked canonical receipt sources. |
| Reserves, conversion and redemption | Native denomination/activation records and separately scoped provider observations | No matching external reserve allocation, funded conversion or settled redemption receipt was verified by this review. |

The managed cloud's enforced HTTP policy does not permit the pinned Base or Kaleido RPC hosts, and no outbound RPC credential was configured at revision 78. No chain call was attempted through another route or a metered browser. The existing Base verifier remains a read-only transfer verifier; it requires a real transaction hash, parties, amount and log index and cannot infer a transfer from a software hash. Supported read-only provider connectors were used successfully. No financial job, payment, mint, unpause or personal charge was initiated.

To spend business funds, the dedicated treasurer must bind the exact available business asset to the single treasury allocation and the authorized budget/destination. A Base operation additionally needs matching on-chain token/network, funded source liquidity, fees and final transfer/provider-credit evidence. An NUSD-to-Base bridge additionally needs verified deployed escrow/vault identities, configured authority, an exact source lock and a matching funded Base release. These findings remain separate from the retained mint and the owner-declared denomination.

1. The dedicated treasurer retrieves the supported owner-authenticated treasury evidence snapshot at `/api/control/v2/treasury/evidence`, or the existing `numina_treasury_evidence` tool. Pass when its exact journal revision/head is stable during capture and the returned signature verifies against the established public pin. An unavailable provider observation remains explicit.
2. Blue review obtains the complete current journal and manifest export through supported authenticated access. Pass when exact payloads and hashes are available for every revision and the snapshot boundary is recorded. The bounded Sites projection is retained as an intermediate readback.
3. The dedicated treasurer obtains a fresh chain observation or an existing later receipt identifying the recorded chain/genesis, token and pause state. Pass when the current activity claim is bound to those exact identifiers and an observed block/time. No replacement token or additional mint is implied.
4. Engineering and the dedicated treasurer reconcile the native treasury with authenticated provider records in their original currencies. Reserve ownership, eligibility, allocation, provider acceptance and settlement are separate findings. Preparation or internal confirmation does not advance them automatically.
5. The release coordinator includes the reviewed team configuration and this report in the canonical build, then records the saved version, source commitment, archive digest and successful deployment readback. Publication authenticates its delivered artifacts; it does not execute any financial task.

Raw connector extracts and private journal records remain in ignored, access-restricted output directories. This review changes no ledger, provider account, financial transaction, retained receipt, signing key or signed manuscript. It used exact record and source checks; no broad automated test run was performed. The new configuration and report are unsigned until the separately recorded delivery signing event.

**Next verifiable step:** retrieve and verify the supported owner-authenticated treasury evidence snapshot for the exact current native journal head, preserving each provider's original evidence scope.
