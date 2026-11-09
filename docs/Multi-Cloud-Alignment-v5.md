# Numina 5 multi-cloud alignment

The shared source release is Numina 5.0.0, core 2.0.0, runtime 2.0.0-rc27 and Node 26.13.0. The canonical configuration is `config/numina-topology.v1.json`. Every cloud remains subject to actual provider evidence.

| Destination | Source role | Live verification |
| --- | --- | --- |
| Cloudflare | `numina-production` Worker, assets and both numinalabs.xyz hostnames | Pending deployment receipt and origin observation |
| Google Cloud | Existing `numina-production` target, project `project-0317d6c9-e943-409e-83f`, us-central1 / us-central1-a | Pending authenticated resource and revision observation |
| AWS | Shared Node container contract; workload and region unresolved | Pending inventory |
| Azure | Shared Node container contract; workload and region unresolved | Pending inventory |
| IBM Cloud | Canonical root web container; separate quantum service | Pending authenticated Code Engine observation |
| IBM Quantum | Research workload and individual job evidence | Independent of production replication |
| Tailscale | Existing private host transport | Pending authorized peer inventory |

Cloudflare deploys the Worker and generated `dist/client` assets. Container platforms use the root Dockerfile and the same generated assets and Worker through the public web adapter. The web adapter explicitly lacks production D1/R2 adapters and signing; a running public container is not proof that private application functions are available. Do not redirect the domain to an unverified cloud origin.

The Cloudflare configuration preserves existing variables, secrets, D1 and R2 bindings through upload metadata. It creates no storage resources. A dedicated `CLOUDFLARE_API_TOKEN` is used for deployment; Numina's application control credential is not a Cloudflare credential.

Read-only inventory, authority verification, reconciliation and illumos compatibility tools are retained in `tools/topology`. Inventory and provider verification must be run with the existing authorized identities. No provider tokens or raw private host data belong in release evidence.

Cross-cloud replication remains disabled until source/target identity, artifact digests, direction, conflict policy, RPO/RTO, encryption custody, isolated restore, failover and rollback results are recorded. No cloud health or replication activation is inferred from source alignment.
