# Local contract development

Run `npm ci --ignore-scripts`, then `npm run compile` and `npm test` from this directory. The lock pins Solidity 0.8.37, OpenZeppelin Contracts 5.4.0, ethers 6.15.0 and Ganache 7.9.2. These are development dependencies; production keeps its separate original lock.

Tests use an in-memory London EVM and test-only wallets. They make no production network calls or deposits. On Node 24 for Windows, Ganache uses its JavaScript fallback when its optional native WebSocket binary is unavailable.

Compilation regenerates the settlement, USDC conversion and USD redemption artifacts. The original NuminaUSD artifact is preserved byte-for-byte and its LF source matches the recorded compiler hash. `scripts/token-artifact.mjs` checks both exact retained inputs before generating token deployment data. Conversion tests use a synthetic reserve token; they establish no live USDC funding or bank payments. See `../../../docs/NUSD-Conversion-Contracts.md` for roles, precision, liquidity, escrow and activation requirements.
