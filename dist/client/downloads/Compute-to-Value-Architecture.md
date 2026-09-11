# Numina Labs: compute-to-value integration specification

Status: proposed architecture. The public scenario is a calculator, not a deployed payment contract. The current rc20 backend remains an authority verifier; no external economic execution is enabled.

## Economic flow

1. A buyer agrees to an outcome, measurable unit, unit price, maximum budget, acceptance authority, recipient, deadline, and dispute/refund rules.
2. The buyer funds an order using an existing eligible reserve-backed stablecoin. Compute does not create the reserves or make the issuer mint currency.
3. A bounded agent performs work. An authenticated meter records order and job IDs, provider/model, units, input/output references, costs, timestamps, and signatures.
4. Customer acceptance is evaluated separately from consumption. A trusted acceptance authority signs the accepted quantity and output identity. Expensive compute alone does not demonstrate useful work.
5. A future contract/adapter releases only the accepted, authorized amount, within available funding. Bind the order, token contract, network, buyer, recipient, fee, and expiry in the signed intent.
6. Reconcile the submitted transaction with an independently observed confirmed transfer. A submitted transaction is not settled payment.
7. An eligible provider may redeem stablecoins to fiat. Track request, provider acceptance, payout, and bank receipt separately. A USDC transfer alone does not prove a bank deposit.
8. Deliver an API result, order, or service and record fulfillment evidence. A receipt records an event; it does not establish ownership of unrelated IP.

## Proposed contract boundary

An order records: unique ID, buyer, authorized acceptor, recipient, approved token and chain, funded amount, unit definition, maximum unit price/quantity, software-fee cap, deadline, dispute procedure, and evidence commitment. No price oracle may replace customer agreement without explicit authorization.

State transitions: proposed -> funded -> work submitted -> accepted or disputed -> release authorized -> transfer submitted -> transfer confirmed -> optional provider payout -> fulfilled. Refund paths must be defined for expiry, rejection, and unresolved disputes; do not lock buyer funds indefinitely.

Release requires verified funding, authenticated metering and acceptance, current authority, unused order/nonce, exact recipient/network/token binding, and non-exceeded caps. External observations require source authentication; a caller-supplied provider name is insufficient.

Implementation controls include checked integer arithmetic in token minor units, fee conservation, signature domain separation, replay and reentrancy protection, checks-effects-interactions, safe token handling, idempotent webhooks, secret isolation, emergency pause and defined upgrade authority. Restrict supported assets rather than assuming every ERC-20 behaves identically. Reconcile fee, recipient amount, provider costs, refunds, and unused funding separately.

Before production: implement adapters and contract code; test settlement/dispute/recovery paths; obtain a contract security review; configure authenticated providers; confirm legal/payment-provider eligibility for the actual flow; validate token/network addresses from official sources; verify funded limits and end-to-end reconciliation in an approved test environment. No mainnet contract address or transaction evidence is asserted here.

## Commercial boundary

Current paid offers are Numina's own diagnostic and systems-audit services, with written scope and acceptance. A future software license or per-accepted-job fee can pay for orchestration and verification. The scenario's fee is illustrative, not a live tariff. Customer payment volume, compute credits, token holdings, software revenue, and earned profit must be tracked distinctly.

USDC issuer backing/redemption terms: https://www.circle.com/legal/usdc-terms

Software development and money-transmission classification depend on actual activities; no exemption is claimed: https://www.fincen.gov/resources/statutes-regulations/administrative-rulings/application-fincens-regulations-virtual
