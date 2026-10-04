# Local contract development

Run `npm ci --ignore-scripts`, then `npm run compile` and `npm test` from this directory. The maintained lock pins Solidity 0.8.37, OpenZeppelin Contracts 5.4.0, ethers 6.17.0 and Hardhat 3.18.1. A scoped override upgrades Solidity's temporary-file helper to tmp 0.2.7. The production dependency lock remains separate.

Tests use an in-process London EVM on chain 1337 with test-only wallets. They create no RPC listener, fork, production network connection or deposit. The maintained test engine replaces archived Ganache and its vulnerable bundled dependencies; Node 24 and Hardhat's platform-specific EDR package are required.

Compilation regenerates the settlement, USDC conversion and USD redemption artifacts. The original NuminaUSD artifact is preserved byte-for-byte and its LF source matches the recorded compiler hash. `scripts/token-artifact.mjs` checks both exact retained inputs before generating token deployment data. Conversion tests use a synthetic reserve token; they establish no live USDC funding or bank payments. See `../../../docs/NUSD-Conversion-Contracts.md` for roles, precision, liquidity, escrow and activation requirements.
