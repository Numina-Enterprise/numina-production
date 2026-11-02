import Stripe from 'stripe';
import { assertReadOnlyConfig, loadConnectorConfig } from './connector-config.mjs';

export class StripeTreasuryConnector {
  constructor({ client, webhookSecret, config = loadConnectorConfig() } = {}) {
    assertReadOnlyConfig(config);
    if (!client || typeof client.treasury?.financialAccounts?.retrieve !== 'function') throw new Error('STRIPE_CLIENT_REQUIRED');
    if (typeof webhookSecret !== 'string' || !webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET_REQUIRED');
    this.client = client;
    this.webhookSecret = webhookSecret;
    this.config = config;
  }

  static async create({ secretResolver, config = loadConnectorConfig(), StripeClass = Stripe } = {}) {
    assertReadOnlyConfig(config);
    if (typeof secretResolver !== 'function') throw new Error('STRIPE_SECRET_RESOLVER_REQUIRED');
    const [apiKey, webhookSecret] = await Promise.all([
      secretResolver(config.stripe.restrictedApiKeyRef),
      secretResolver(config.stripe.webhookSecretRef),
    ]);
    if (typeof apiKey !== 'string' || !/^rk_(test|live)_/.test(apiKey)) throw new Error('STRIPE_RESTRICTED_KEY_REQUIRED');
    const client = new StripeClass(apiKey, { apiVersion: config.stripe.apiVersion, stripeAccount: config.stripe.accountId });
    return new StripeTreasuryConnector({ client, webhookSecret, config });
  }

  verifyWebhook(rawBody, signatureHeader) {
    if (!Buffer.isBuffer(rawBody) && typeof rawBody !== 'string') throw new Error('STRIPE_RAW_BODY_REQUIRED');
    return this.client.webhooks.constructEvent(rawBody, signatureHeader, this.webhookSecret);
  }

  async retrieveFinancialAccount(financialAccountId) {
    if (!/^fa_[A-Za-z0-9]+$/.test(financialAccountId || '')) throw new Error('STRIPE_FINANCIAL_ACCOUNT_ID_INVALID');
    return this.client.treasury.financialAccounts.retrieve(financialAccountId);
  }

  async listTransactions(financialAccountId, params = {}) {
    if (!/^fa_[A-Za-z0-9]+$/.test(financialAccountId || '')) throw new Error('STRIPE_FINANCIAL_ACCOUNT_ID_INVALID');
    if (params.limit !== undefined && (!Number.isInteger(params.limit) || params.limit < 1 || params.limit > 100)) throw new Error('STRIPE_PAGE_LIMIT_INVALID');
    return this.client.treasury.transactions.list({ financial_account: financialAccountId, ...params });
  }

  async readPaymentIntent(paymentIntentId) {
    if (!/^pi_[A-Za-z0-9]+$/.test(paymentIntentId || '')) throw new Error('STRIPE_PAYMENT_INTENT_ID_INVALID');
    return this.client.paymentIntents.retrieve(paymentIntentId);
  }
}
