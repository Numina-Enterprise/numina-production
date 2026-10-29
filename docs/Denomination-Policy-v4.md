# Shared Numina denomination policy

Numina declares **1 NUSD = 1 USDC = 1 USD**. The canonical policy is published as `denomination_policy` in the NUSD status, architecture, control manifests, service catalog and application release. The policy describes declared valuation; each provider currency retains its identity and precision.

All five architecture layers share the existing native treasury at `/api/control/v1/treasury`. The native projection is counted once. Numina OS, the control room and the hosted mobile UI display the same policy. Android and iOS load the canonical hosted application and receive its online updates; their existing binary signatures and historical build records remain unchanged.

Integration status, release, network and runtime-build discovery preserve the policy when supplied by the configured server. Older responses may omit it. The Codex plugin reads it through the existing architecture and capability tools. Downloadable packages do not install themselves into third-party hosts.

This policy changes neither provider balances nor token identity, backing verification, conversion availability or payment status. External funding and completed transactions require their corresponding provider evidence. The frozen treasury model, historical reserve/redemption policies and journal are retained.
