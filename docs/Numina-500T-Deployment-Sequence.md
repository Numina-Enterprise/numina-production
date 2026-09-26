# Owner-signing sequence for the approved 500T review

## Historical review scope

This sequence belongs to the September 16, 2026 **500T, six-decimal uncapped review**. Its requests, archives, policies and checksums retain that scope. For the confirmed deployment, Numina's September 18, 2026 [mint receipt](/downloads/nusd/mint-receipt.json) records **1,500T NUSD at 18 decimals**, chain `962421430`, block `51725`, receipt `0x1`, transaction `0x86578ab250a1b0d23bc801338bf1530d07a93dc5e09965da5088ff57baac0a1b` and contract `0x491c1DF1b5CA77AF797f052c2310ca17039C931b`. The separate settlement-contract deployment occurred at block `51726`.

The [current minting guide](/downloads/NUSD-Minting-v4.md) identifies those records. The Numina Native Treasury journal remains the software source of truth. This historical sequence describes a different constructor request; it does not replace the confirmed token identity or the current journal and provider evidence.

Status: preparation and simulation. No production deployment, signature, broadcast, token address, provider deposit or native journal update is established by this document.

The [preparation package](Numina-500T-Deployment-Handoff.zip) contains the v3 token request, three dependent input sheets, receipt-verification checklists and a machine-readable list of unresolved inputs. ZIP SHA-256: `858a8efd985be4b19c9b8a4df90a6d0145b61a0c39354759d5afa83a284a2afd`.

The [preparation tools](Numina-500T-Preparation-Tools.zip) add the matching eight-argument encoder, a read-only RPC observer, receipt consistency checks and eight review-evidence intake records. Start with `tool/README.md` inside that archive. Its [package record](numina-500t-preparation-tools-record.json) provides the exact hash. These tools cannot replace owner wallet selection, independent reviews or provider-origin evidence.

Use the [deployment readiness workspace](https://numinalabs.xyz/deployment-readiness) to review all 36 package requirements and collect a local draft. It exports a recipient request compatible with the tools above. Only the recipient is changed in that request; the six-field local draft separately retains your network and fee notes. Form input, import and export do not approve reviews, verify funds, encode a transaction or submit one.

## 1. Resolve and encode the exact request

- Verify the intended network identity through its authenticated RPC, including chain ID and genesis block hash. Confirm the signing sender, nonce, fee asset, gas estimate and fee budget on that network.
- Resolve the NUSD token recipient as an address able to hold NUSD on that network. A Stripe USDC deposit address or bank-account reference is not a substitute.
- Resolve each review finding using its actual supporting evidence, including security, issuer/jurisdictions, custody/reserves, redemption operations, financial-crime controls, role custody, incident recovery and settlement integration. Owner approval is recorded separately from those findings.
- The approved initial supply is **500000000000000 NUSD**, or **500000000000000000000 base units**. This positive amount **mints during deployment**. Zero issuance requires an explicitly revised request and policy, with a freshly encoded draft and new request/policy hashes.
- Use the reviewed uncapped v3 artifact and its eight constructor parameters: `initialSupplyBaseUnits`, `initialRecipient`, `admin`, `issuer`, `minter`, `pauser`, `adminDelaySeconds`, `approvedIssuerPolicyHash`. Never feed it through the retained capped v2 nine-parameter encoder.
- Bind the final unsigned transaction to the exact request, artifact and issuer-policy hashes. An incomplete request must remain unencoded.

## 2. Owner signs NUSD deployment

The owner reviews and signs the fully specified NUSD transaction in their wallet. After successful finality on the intended chain, record the actual receipt and verify:

- Contract address from that receipt and matching deployed runtime, including immutable policy-hash binding.
- Administrator, issuer, minter and pauser addresses and administrator delay.
- Supply policy: this uncapped version has **no configurable cap or `cap()` accessor**, and remains bounded by `uint256`.
- Exact initial total supply, recipient balance and constructor mint event.
- Issuer-policy hash, six decimals and paused state.

Do not mark application deployment metadata as complete from an unsigned draft, a local simulation receipt or owner approval alone.

## 3. Fill the three dependent requests

Use the **confirmed deployed NUSD address** for NuminaSettlement, NuminaUSDCConversion and NuminaUSDRedemption input sheets. Do not predict or substitute an address. These contracts may be deployed independently after NUSD when each request is complete.

USDC conversion additionally requires the official six-decimal USDC contract on the **same chain** and a supported funded conversion path. Verify its identity from the issuer and on-chain code. A USDC deposit destination on another chain does not satisfy this requirement.

## 4. Review, sign and record each result separately

Review and sign each final transaction separately in the owner's wallet. Record and verify each actual result before updating its application metadata. Contract deployment, minting, conversion and provider deposit are separate operations; each needs its own successful receipt and verified asset, amount, source and destination.

Any native treasury record must use the existing owner-authenticated `POST /api/control/v1/treasury` write path with its stable event ID, expected revision and head. Supported prepared requests remain `PREPARED`, with `submission_performed: false` and `receipt: null`; they cannot be relabeled as completed transfers.
