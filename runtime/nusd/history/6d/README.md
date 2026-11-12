# Superseded 6-decimal NUSD contract candidates

These files were the active `runtime/nusd/contracts/` and `runtime/nusd/artifacts/` sources on `main`
from commit 92800a52 (2026-09-20) until the 18-decimal reconciliation on 2026-11-11. They were moved
here with `git mv` and are kept byte-for-byte unchanged.

They were never deployed. The deployed NUSD token is
`0x491c1DF1b5CA77AF797f052c2310ca17039C931b` on the Numina chain (chain ID 962421430). It uses
**18 decimals**, and supply equals cap at 1.5e33 base units (1.5e15 NUSD). See
`runtime/nusd/mint-receipt.json` (tx `0x86578ab2…aac0a1b`, block 51725) and
`runtime/nusd/deployment-receipt.json`.

| File | Superseded by |
| --- | --- |
| `contracts/NuminaUSD.sol` (decimals() = 6) | `runtime/nusd/contracts/NuminaUSD.sol`, restored byte-for-byte from `history/18d` (source SHA-256 `08fdd4e8…`, artifact SHA-256 `3e9d8f22…`, matching the deployment receipt) |
| `contracts/NuminaUSDCConversion.sol` (1:1 base-unit parity) | `runtime/nusd/contracts/NuminaUSDCConversion.sol`, restored byte-for-byte from `history/18d` (1e12 scale; amounts not divisible by 1e12 are rejected) |
| `contracts/NuminaUSDRedemption.sol` (10,000 units per cent) | `runtime/nusd/contracts/NuminaUSDRedemption.sol`: this 6d source with its later reconciliation logic kept, and only the two decimal-dependent constants changed to 18 decimals (10^16 units per cent; requires decimals() == 18). Recompiled with the pinned toolchain in `runtime/nusd/development`. |

Do not deploy anything in this folder.
