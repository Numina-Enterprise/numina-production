# Create a local recipient wallet

Open [Deployment readiness](https://numinalabs.xyz/deployment-readiness) and expand **Create a recipient wallet on this device**.

1. Enter and confirm a unique password of 16–128 characters.
2. Choose **Create and encrypt wallet** yourself. Creation runs in an isolated browser worker.
3. Download the encrypted wallet JSON file. Save it and keep its password separately. Numina does not receive either and cannot recover them.
4. Confirm that you saved the backup, then choose **Use this public address as recipient**. This changes only the local recipient input. Export the constructor request separately when ready.

The backup uses the standard version 3 JSON keystore format. Recover it with compatible wallet software using the saved password. The password is not a recovery phrase. Losing the file or password can prevent recovery; do not send either through chat or a support form.

## Implementation and limits

- The same-origin ethers 6.15.0 browser distribution supplies cryptographic randomness and keystore encryption. The exact bundle hash and license notices are published under `/vendor/ethers-6.15.0-record.json` and `/vendor/ethers-6.15.0-LICENSES.txt`.
- Encryption retains the library's scrypt defaults: N=131072, r=8, p=1, with fresh salt and IV. It uses the library's AES-128-CTR keystore format and authentication check. No weakened production KDF settings are accepted by the UI.
- Passwords are cleared from the form before being passed to the local worker. The worker returns only a public address and encrypted keystore, then closes. There is no server wallet endpoint, provider connection, wallet key storage, signing or broadcast path.
- The application does not render raw keys or recovery phrases. Errors use fixed messages. Secrets are excluded from ordinary readiness drafts and constructor-request exports.
- Cancellation and navigation invalidate in-flight work. Browser JavaScript cannot promise physical memory zeroization. Use a trusted device and keep the application and browser up to date.
- The download button requests a file download; it cannot prove the file was saved. Backup confirmation is the user's acknowledgement, not an independently verified recovery test.
- This creates an empty EVM address. It does not establish Numina network permissioning, independently reviewed custody, provider acceptance, token issuance, reserves or settled funds. It does not replace the four separately approved role addresses.
- The declared 1:1 NUSD:USDC:USD policy remains a denomination policy. All deployment, funding, conversion and settlement evidence requirements remain in force.

This browser wallet feature has not received an independent security audit. Local tests use a public, deliberately insecure fixture and synthetic worker responses; they never create or fund a production wallet or submit a transaction.

Library reference: [ethers wallet documentation](https://docs.ethers.org/v6/api/wallet/).
