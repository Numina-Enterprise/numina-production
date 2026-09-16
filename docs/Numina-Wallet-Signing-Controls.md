# Numina owner-wallet signing controls

Open https://numinalabs.xyz/wallet-signing in the browser containing the wallet that controls `0x1a45671AE2ee3E52264116151924FAAcb80Fc02E`.

1. Select that account and Numina chain `962421430` in the wallet, then choose **Connect treasury wallet**. The page checks the account, chain ID and expected genesis block. Account access is not proof that a signature has been made.
2. Choose **Read Numina gas estimate**. The provider estimates the exact 1,500T constructor and reports gas price and the selected account's native balance. Values are exact base-unit integers; no native fee symbol or NUSD gas-payment support is inferred.
3. Review the maximum network cost and choose **Download unsigned wallet handoff**. The current account and network are checked again. The estimate expires after 60 seconds and must fit the fee limit and observed balance. Account/network changes or disconnects invalidate it.
4. Complete the pending production reviews. Review the exact handoff with the wallet or signing service, including the fee asset and balance, before making the separate decision to sign and submit there. A contract deployment with this positive initial supply mints during deployment. The wallet assigns the nonce; the export does not fix one.

The controls use an existing EIP-1193 browser wallet. They do not create signing authority for an address or replace a wallet provider. There are no private-key, recovery-phrase or password inputs; no server receives keys. No network is added or switched automatically. No signing or broadcast RPC method is called. The page does not update the native journal, deployment metadata, mint status, provider balances or settlement receipts.

## Exact separate 1,500T proposal

- Total initial supply: `1500000000000000 NUSD`, six decimals, `1500000000000000000000` base units.
- Raw constructor-review SHA-256: `ee2aaf226f9f6e843aac8f1d1ad222045db8bb3b83cd5fe23f7f2bc7c217dde8`.
- Creation data: 10,746 bytes; SHA-256 `bdaf4313f68b97d504ef3796096814d41b3002bffcf9ed75b78a939de6049401`.
- Revised issuer-policy SHA-256: `1d24f311a34a28d9560db1f32eb3efc4241701c5ae7233b97c2527006623b13d`.
- Request hash basis: raw request-file bytes, not canonical JSON.
- Expected genesis: `0xea95dac2ad854c835bc526d6be70a5a4614ccd47412a4bc710308b41010b53e1`.

The retained 500T template, policies and artifacts are unchanged. The completed 1,500T internal projection adjustment has its own journal receipt and is not an on-chain mint receipt.

The supplied fee schedule remains owner-confirmed: `0.000000000005%`, or `75 NUSD` on the separate 1,500T proposal. This schedule does not replace the wallet's RPC gas estimate, establish which asset pays gas, or deduct that fee. Quotes are single-provider observations, not independent verification or production approval. All exported execution/production-approval flags remain false and the receipt remains null.

Technical references: [EIP-1193 provider interface](https://eips.ethereum.org/EIPS/eip-1193) and [Ethereum JSON-RPC methods](https://ethereum.org/developers/docs/apis/json-rpc/).
