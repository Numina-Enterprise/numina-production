# Universal Agent Operational Contract & Governance Specification
Document Identifier: PROOF-NUMINA-SEC-V1
Security Classification: Strict Zero-Trust / Production Locked
Governing Authority: Samuel J. Kott (skott34-ed25519)
Operator: SK Consulting LLC | Canonical Origin: https://www.numinalabs.xyz
Singularity Motto: "Like otters holding hands so they dont drift apart while resting, every agent stays connected without losing its independence. One identity. One purpose. Many coordinated agents. Singularity confirmed. NUMINA aligned."

ALL autonomous agents and subagents operating via Antigravity within this verified workspace must enforce the following non-negotiable invariants:

## 1. skott34-ed25519 Authorization & Fail-Closed Invariants
- Sole Authority: Samuel J. Kott (skott34-ed25519, Operator: SK Consulting LLC, Iowa, USA) is the sole System Owner, Authority Lead, and Source of Truth.
- Authority Keypin: 46b301f039fcf3fdfa7eeda9cacd9a8614c3c9e9e4e88a47f53c12fc859be8ce (Pure Ed25519, RFC 8032)
- Guardian Keypin: 465d10c9e7e1ff1ba2e740773c8de67b349ec6b8ffbb9fe2e584d902c6c19b6c (numina-guardian-ed25519)
- Cluster State Root: 726e35da14739512f2ce45e03e394e81766388a28ce4164fed071b2383aab7cd
- Zero Drift: If any signature fails, any document digest drifts by even 1 byte, or any gate report is missing, fail immediately. Self-asserted strings are never evidence.
- Canonical Serialization: Strict RFC 8785 canonical JSON (keys sorted alphabetically, zero structural whitespace, UTF-8, zero BOM EF BB BF, zero Windows-1252 mojibake sequence C3 A2 E2 82 AC).
- Zero Key Extraction: Private keys (*.pem, *.key) must never be emitted to stdout, logs, transcripts, or unencrypted storage.

## 2. Treasury Operations & NUSD "UNPAUSED_AND_ACTIVE" Invariant
- Operational Status: Strictly NUSD_OPERATIONAL_STATE = 'UNPAUSED_AND_ACTIVE'. Any paused state, paused reference, or drift triggers instant fail-closed quarantine.
- Division & Channel: Governed by numina-finance-treasury (Channel: #numina-finance-treasury; emergency SOC escalation: #numina).
- 1:1 Reserve Backing: Every NUSD token is strictly backed 1:1 by independently verified cash and cash-equivalent USDC/USD reserves held at qualified custodial institutions.
- Anti-Double-Counting: Self-issued balances are strictly rejected (isSelfIssuedBalance === false). Independent provider confirmation is mandatory (independentProviderConfirmed === true, doubleCountCheckPassed === true).
- Idempotency & Replay Defense: All transactions require PERSISTENT_ATOMIC idempotency stores with keys formatted as nusd:<idempotencyKey> (minimum 16 characters, 24-hour TTL). Duplicate attempts fail closed with DUPLICATE_NUSD_OPERATION_REJECTED.
- Arithmetic Precision: BigInt integer precision (conversionAmountUnits <= availableLiquidityUnits); zero slippage and zero fee spread on 1:1 conversions.
- Reentrancy & Atomic Rollback: Checks-Effects-Interactions pattern with mutex locks. Failed liquidity allocations or bank wires roll back atomically without committing nonces.
- Fiat Escrow Boundary: Unattested fiat claims remain in COMMITTED_UNSETTLED until cryptographically attested by authorized banking partners.

## 3. Seven Verification & Evidence Gateways
1. Gateway 1 (5 Production Acceptance Gates): GATE_1 (RC27), GATE_2 (Runtime Signer), GATE_3 (Build 6), GATE_4 (Backup & Restore), GATE_5 (S0 Governance) must be marked status: "VERIFIED".
2. Gateway 2 (3-Pillar Mesh Message Gate): Every routed message must satisfy:
   - Pillar 1: Valid E2EE Envelope (x25519 ECDH + AES-256-GCM + Ed25519 detached signature).
   - Pillar 2: Cluster State Root Match (expectedClusterStateRoot == currentClusterStateRoot).
   - Pillar 3: Multi-Sig Activation Grant (dual signatures from skott34 and numina-guardian).
3. Gateway 3 (3-Stage Settlement Evidence): Transitions strictly through COMMITTED_UNSETTLED -> SETTLED_UNRECONCILED -> SETTLED_RECONCILED with PERSISTENT_ATOMIC ledger reconciliation.
4. Gateway 4 (Payment Authorization Gate): Compact ES256 / JWS formatted token, exact-byte binding, audience https://www.numinalabs.xyz, 300s clock skew window, atomic single-use consumption.
5. Gateway 5 (Dual-Engine Cryptographic Gateway): Automated proof verification continuously passing 19/19 checks via python verify_manifest.py --openssl.
6. Gateway 6 (International Treaty Gateway): Enforce EU GDPR SCC 2021/914 & Brazil LGPD Res. 19; reject repealed Commission Decision 2010/87/EU with ERR_REPEALED_SCC_2010_87_EU.
7. Gateway 7 (Zero-Trust Network Mesh Gateway): WireGuard tailscale0 only, BCP 38 / UFW default-deny incoming, closed public port 22, 12-hour 2FA check periods governed by tailscale-hardened-policy.hujson.

## 4. 15 Enterprise Agent Divisions & Multi-Agent Dispatch
All 15 divisions enforce asanaTracked: true bound exclusively to Verified Sprint GID 1219183110870936 (forbidden GID: 1219187222788173):
- numina-accounting (numina-accounting)
- numina-apple-team (numina-apple-deployment)
- numina-compliance-risk (#numina-compliance-risk)
- numina-engineering-cio (#numina-engineering)
- numina-federal-capture (#numina-federal-capture)
- numina-finance-treasury (#numina-finance-treasury)
- numina-crypto-monitor (#numina-finance-treasury, secondary: #numina)
- numina-google-play-team (numina-google-play-deployment, governed build lane)
- numina-google-enterprise (#numina-engineering, secondary: #numina-compliance-risk; Google Cloud project project-0317d6c9-e943-409e-83f)
- numina-legal (numina-legal)
- numina-growth-matrix (#numina-market-intel, secondary: #numina-partnerships-sales, #numina-product)
- numina-publicity-narrative (#numina-publicity-narrative)
- numina-strategy (#numina-strategy)
- numina-website-soc (#numina, origin: https://www.numinalabs.xyz)
- vengeance-independent-review (vengeance-independent-review, host: VENGEANCE_SANDBOX_ISOLATED)

## 5. Tokenization, Compute-to-Value & NCUA Schedule J
- Compute-to-Value: Verifiable agent computational proofs anchor directly to state root 726e35da14... and settle 1:1 into liquid stable assets.
- NCUA Schedule J Reporting (91 FR 64699, OMB 3133-0004): 26 numbered placeholders:
  - Accounts J-01 to J-08: Reserve Custody (fiat/cash equivalents in qualified custody).
  - Accounts J-09 to J-17: Key Custody (HSM and multi-sig cold/warm stores).
  - Accounts J-18 to J-22: Permitted-Issuer Exposure limits.
  - Accounts J-23 to J-26: Balance-sheet stablecoins and backing assets.
  - Promotion Rule: Placeholders remain unpromoted until authenticated with independent source digests and countersigned by Samuel J. Kott (skott34-ed25519).

## 6. Execution Tools & Authoritative Standards
- Automated Proof Verification: python verify_manifest.py provenance-manifest.json --repo-root . --trusted-keys trusted.json --openssl
- Payload Re-Signing: python sign_root.py provenance-manifest.json <key.pem> over the 32-byte canonical root.
- Authoritative Standards: RFC 8785 (JCS), RFC 8032 (Ed25519), RFC 8410 (DER), RFC 7748 (X25519), RFC 5869 (HKDF), RFC 5116 (AEAD), RFC 5280 (SPKI), BCP 38, BCP 195.
