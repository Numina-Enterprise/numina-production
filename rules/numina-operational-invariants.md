# Numina Operational & Swarm Invariants

## 1. Provenance Manifest & Policy Decoupling
- Never modify the canonical body of a signed provenance manifest to satisfy verification policy changes.
- Manifest updates invalidate existing Ed25519 signatures (`skott34-ed25519` and `numina-guardian-ed25519`).
- Supply policy extensions (e.g. `numina-v1 signing transcript`) via out-of-band `--policy <path>` arguments to maintain root identity.

## 2. Institutional RWA & Digital Asset Invariants
- All tokenized asset ledgers (BUIDL, BENJI/FOBXX, USDY, cash deposits) must use strict 6-decimal micro-unit `BigInt` arithmetic.
- Solvency validation must prove 1:1 asset backing against circulating NUSD without floating-point approximations.
- Anchor all asset registrations with SHA-256 attestation hashes bound to Cluster State Root `726e35da14739512f2ce45e03e394e81766388a28ce4164fed071b2383aab7cd`.

## 3. PowerShell CLI Execution Standards
- When invoking PowerShell scripts that define `[switch]` parameters, pass them as flags (e.g. `-SingleCycle`), never as string literals or boolean conversions (`-SingleCycle:$true` can trigger `ParameterArgumentTransformationError`).

## 4. CI/CD & Build Invariant: Deny Self-Hosted Runners
- Self-hosted GitHub Actions, GitLab runners, or unauthorized persistent build agents are STRICTLY PROHIBITED across all Numina repositories and infrastructure.
- Zero Self-Hosted Runners: All automated builds, CI pipelines, tests, container image builds, and deployment jobs must execute exclusively on ephemeral, cloud-hosted environments (e.g., GitHub-hosted `ubuntu-latest`, `macos-latest`, `windows-latest`, Google Cloud Build in `project-0317d6c9-e943-409e-83f`, or Apple Xcode Cloud).
- Any configuration, workflow file, or trigger specifying `runs-on: self-hosted` or binding local developer workstations/daemons to external CI pipelines is rejected fail-closed to prevent workstation persistence compromise, lateral privilege escalation, and credential exfiltration.

## 5. High-Precision Currency Formatting & Oracle Invariant
- Never convert BigInt micro-units (or amounts exceeding Number.MAX_SAFE_INTEGER) to standard JavaScript Number floats for formatting or display.
- All currency string representations must use pure BigInt integer math:
  - Whole units: `absMicro / 1_000_000n`
  - Fraction: `absMicro % 1_000_000n`
  - Cents: `(fraction / 10_000n).toString().padStart(2, '0')`
- Standard float conversions (`toLocaleString` with float division) are prohibited on institutional rails to eliminate mantissa rounding errors.

## 6. Strict Type Coercion & Account Boundary Invariants
- Pre-validate all numeric strings with `/^(?:0|[1-9]\d*)$/` before invoking `BigInt()` to eliminate silent boolean and whitespace coercion.
- Account identifiers must be non-empty trimmed strings; any `null`, `undefined`, whitespace, or non-string account argument must throw an explicit `TypeError`.
- Webhook signature timestamps must strictly match `/^\d+$/` prior to parsing.
