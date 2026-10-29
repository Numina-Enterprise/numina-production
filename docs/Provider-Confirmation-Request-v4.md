# Provider confirmation request

This document collects evidence issued by a bank or asset provider. It is an unfilled request template, not a confirmation that funds exist. Owner approval authorizes use of the template; it does not authenticate a provider or change an account balance.

Download the [structured template](/downloads/provider-confirmation-request.template.json). Use a separate private copy for each provider and each currency. Keep completed copies and source documents in the owner-controlled treasury workspace; do not commit private account records or credentials to the public source.

## Required provider record

Record the provider name, public or masked account reference, issuer reference, source timestamp and the original document or authenticated API observation. Preserve the source document and its SHA-256 digest. A digest proves byte integrity; it does not authenticate the issuer.

Record the original currency, exact integer amount in the smallest unit, decimal precision and balance bucket. USD and USDC keep their own units. An absent balance is unknown, not zero. Only a provider-reported zero may be recorded as zero.

For a token destination, record the provider-supported network, token contract and destination. An address alone does not establish acceptance of NUSD. Keep the native NUSD journal projection as a reference rather than replacing provider-reported amounts with it.

## Allocation and settlement

Record the source funds, allocation reference, allocated amount and encumbrances. When several views reference one allocation, keep the same allocation identifier and count it once. Separate deposits consume separate funds; a shared display cannot fund both transfers.

Record a completed settlement only from its actual transaction reference and receipt. A completed NUSD mint additionally needs the intended chain, deployed token identity and a confirmed issuance event matching the recipient and amount. Neither an owner approval nor a document upload substitutes for these records.

## Review and storage

In the control room, choose **Read treasury reconciliation and evidence** to read a fresh snapshot. Its reconciliation section links the native treasury identity, revision and head to the captured provider source records. It reports each currency's evidence status and the remaining deposit requirements. The section does not add balances across references or initiate a transfer. A changed treasury snapshot must be refreshed before it can be displayed with that account view.

The existing owner-only document route is `/api/control/v1/treasury-documents`; the evidence snapshot is `/api/control/v2/treasury/evidence`. Uploading an authentic source document creates a file-storage receipt with unverified issuer status. This template adds no automatic provider verifier or new treasury write route.

Capture owner approval separately from issuer authentication, amount verification, allocation verification, provider asset acceptance and completed settlement. Leave each unsupported field unverified. Signing and submission remain with the owner's wallet or provider.
