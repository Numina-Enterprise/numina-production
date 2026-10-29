# Numina Native Treasury - Stripe App

Official Stripe Dashboard extension for the Numina Native Treasury, facilitating real-time ledger synchronization, atomic 3-stage settlement verification, and NCUA Schedule J reserve auditing.

Based on official Stripe Apps documentation: [Upload and Install a Stripe App](https://docs.stripe.com/stripe-apps/upload-install-app).

---

## Architecture & Features

- **Dashboard Context View**: Visualizes NUSD operational status (`UNPAUSED_AND_ACTIVE`), 1:1 USD parity, and cluster state root (`726e35da14...`).
- **Customer View**: Embedded view under customer detail pages displaying BigInt settlement states and dual-key signatures.
- **Security & Idempotency**: Cryptographically bound to HMAC-SHA256 webhook signatures with `PERSISTENT_ATOMIC` idempotency keys.

---

## Deployment & Installation Guide

### Prerequisites
1. Install Stripe CLI:
   ```bash
   # Windows (via scoop or winget)
   scoop install stripe-cli
   # macOS (via homebrew)
   brew install stripe/stripe-cli/stripe
   ```
2. Authenticate CLI:
   ```bash
   stripe login
   ```

### 1. Local Development & Preview
To run the app locally with hot reloading against your Stripe Dashboard test mode:
```bash
npm install
npm run start
# Or using Stripe CLI:
stripe apps start
```

### 2. Upload App Version
Per [Stripe Apps Upload Guide](https://docs.stripe.com/stripe-apps/upload-install-app):
```bash
stripe apps upload
```
This packages the app bundle and registers the version (`0.1.0`) with Stripe.

### 3. Install App to Account
Once uploaded, install the app directly into your Stripe account:
```bash
stripe apps install --version 0.1.0
```
To install across multiple accounts or preview in test mode, follow the Stripe CLI prompts or pass `--account <acct_id>`.
