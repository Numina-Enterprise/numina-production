import { loadConnectorConfig, assertReadOnlyConfig } from './connector-config.mjs';
import { requestJson, requestText } from './connector-http.mjs';
import { parseCamt053 } from './camt-parser.mjs';

export class BofACashProConnector {
  constructor({ config = loadConnectorConfig(), secretResolver, clientAssertionProvider, http = { requestJson, requestText } } = {}) {
    assertReadOnlyConfig(config);
    if (typeof secretResolver !== 'function') throw new Error('BOFA_SECRET_RESOLVER_REQUIRED');
    if (typeof clientAssertionProvider !== 'function') throw new Error('BOFA_CLIENT_ASSERTION_PROVIDER_REQUIRED');
    this.config = config;
    this.secretResolver = secretResolver;
    this.clientAssertionProvider = clientAssertionProvider;
    this.http = http;
    this.accessToken = null;
    this.accessTokenExpiresAt = 0;
  }

  async _token() {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt - 30_000) return this.accessToken;
    if (!this.config.bank.tokenEndpoint) throw new Error('BOFA_TOKEN_ENDPOINT_REQUIRED');
    const [cert, key, clientSecret] = await Promise.all([
      this.secretResolver(this.config.bank.clientCertRef),
      this.secretResolver(this.config.bank.privateKeyRef),
      this.secretResolver(this.config.bank.clientSecretRef),
    ]);
    const clientAssertion = await this.clientAssertionProvider({ clientId: this.config.bank.clientId, tokenEndpoint: this.config.bank.tokenEndpoint, clientCertificate: cert });
    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: this.config.bank.clientId || '', client_secret: clientSecret, client_assertion: clientAssertion, client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer' }).toString();
    const token = await this.http.requestJson(this.config.bank.tokenEndpoint, { method: 'POST', cert, key, body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    if (typeof token.access_token !== 'string' || !Number.isFinite(Number(token.expires_in))) throw new Error('BOFA_TOKEN_RESPONSE_INVALID');
    this.accessToken = token.access_token;
    this.accessTokenExpiresAt = Date.now() + Number(token.expires_in) * 1000;
    return this.accessToken;
  }

  async _request(path, { accept = 'application/json' } = {}) {
    const token = await this._token();
    const [cert, key] = await Promise.all([this.secretResolver(this.config.bank.clientCertRef), this.secretResolver(this.config.bank.privateKeyRef)]);
    const relativePath = path.startsWith('/') ? path.slice(1) : path;
    return this.http.requestText(new URL(relativePath, `${this.config.bank.endpoint}/`).toString(), { cert, key, headers: { Authorization: `Bearer ${token}`, Accept: accept } });
  }

  async getBalance(accountId) {
    if (!accountId) throw new Error('BOFA_ACCOUNT_ID_REQUIRED');
    const response = await this._request(`/accounts/${encodeURIComponent(accountId)}/balances`);
    if (response.status < 200 || response.status >= 300) throw new Error(`BOFA_BALANCE_HTTP_${response.status}`);
    try { return JSON.parse(response.body.toString('utf8')); } catch { throw new Error('BOFA_BALANCE_JSON_INVALID'); }
  }

  async listStatements(accountId, { from, to } = {}) {
    if (!accountId) throw new Error('BOFA_ACCOUNT_ID_REQUIRED');
    const query = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) });
    const response = await this._request(`/accounts/${encodeURIComponent(accountId)}/statements?${query}` , { accept: 'application/xml' });
    if (response.status < 200 || response.status >= 300) throw new Error(`BOFA_STATEMENTS_HTTP_${response.status}`);
    return parseCamt053(response.body.toString('utf8'));
  }

  async getStatement(statementId) {
    if (!statementId) throw new Error('BOFA_STATEMENT_ID_REQUIRED');
    const response = await this._request(`/statements/${encodeURIComponent(statementId)}`, { accept: 'application/xml' });
    if (response.status < 200 || response.status >= 300) throw new Error(`BOFA_STATEMENT_HTTP_${response.status}`);
    return parseCamt053(response.body.toString('utf8'));
  }
}
