# Numina v3 rc26 production

Runtime deployment dpl_CZn5UMq3fcBYcEZ8j5yLRmDc6874 uses source fd9f2274355bb5dc3c057d0d92301239a47e2012 and build 1e43b674cf71438f128b6bc3ed02a45349ac382a992c3899ba847ee6e89dbb8f. The signed core binding joins the preserved v1.8.0 frozen core to the canonical Numina root under rc26.

The authenticated evidence revocation route is restored and retains original records and first revocation receipts. Its authorization, size limits, retries, concurrency and signature binding have focused regression coverage. No production record was revoked.

Existing native binaries, signing identities and store statuses are preserved. The 500T NUSD native treasury remains one projection; plan and owner-declaration events are retained without rewriting history or changing provider balances. See RC26-Singularity-v3.md for scope and retained SLSA evidence.
