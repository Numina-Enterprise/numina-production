import { assertReadOnlyConfig, loadConnectorConfig } from './connector-config.mjs';
import { requestJson } from './connector-http.mjs';

export class SettlementRailConnector {
  constructor({ config = loadConnectorConfig(), authProvider, http = requestJson } = {}) {
    assertReadOnlyConfig(config);
    if (typeof authProvider !== 'function') throw new Error('SETTLEMENT_AUTH_PROVIDER_REQUIRED');
    this.config = config;
    this.authProvider = authProvider;
    this.http = http;
  }

  async getTransferStatus(transferId) {
    if (typeof transferId !== 'string' || !transferId) throw new Error('SETTLEMENT_TRANSFER_ID_REQUIRED');
    const token = await this.authProvider();
    return this.http(`${this.config.settlement.endpoint}/transfers/${encodeURIComponent(transferId)}`, { headers: { Authorization: `Bearer ${token}` } });
  }

  async listTransfers(query = {}) {
    const token = await this.authProvider();
    const url = new URL(this.config.settlement.endpoint);
    for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, String(value));
    return this.http(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  }

  submitTransfer() {
    throw new Error('DRY_RUN_REJECTED_BY_GATE');
  }
}
