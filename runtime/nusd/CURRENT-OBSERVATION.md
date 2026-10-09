# Current NUSD observation

From the repository root, use Node 26.10.0:

```sh
node runtime/nusd/scripts/observe-current.mjs
```

The compatibility command `node runtime/nusd/scripts/verify-production.mjs` performs the same read-only observation. Both commands accept no arguments and emit one JSON object to stdout. A positional output filename returns `NUSD_OBSERVATION_OUTPUT_PATH_DISABLED`; historical deployment and mint receipts are never rewritten.

Configure `NUMINA_RPC_URL` with an HTTPS RPC endpoint and an existing RPC app credential, such as `NUMINA_RPC_AUTHORIZATION` or `NUMINA_RPC_USERNAME` plus `NUMINA_RPC_PASSWORD`. Missing RPC or app authentication returns an explicit `BLOCKED` record and exits with status 1. Admin credential bootstrap is disabled. The observer does not create credentials, access a signer, broadcast transactions, change pause state, or write files.

The read binds chain `962421430`, the retained genesis hash, token `0x491c1DF1b5CA77AF797f052c2310ca17039C931b`, recipient `0x1a45671AE2ee3E52264116151924FAAcb80Fc02E`, and 18 decimals. A wrong chain, genesis, precision, missing code, malformed result, or changed block fails closed. Token supply, cap, pause state, and recipient holdings are read at one numbered block; its hash and chain are checked again before an observation is emitted.

The September 18 issuance is retained as historical context. Current supply and holdings may differ, and either observed pause value is reported. Runtime code is hashed, but correspondence to the deployment bytecode remains unverified. The observation describes one configured provider's report; it does not establish independent consensus, finality, operational readiness, backing, conversion, or USD/USDC/bank settlement.

The verification workflow preserves stdout as a separate current-observation artifact. Without a successful fresh RPC observation, current chain state remains unknown.
