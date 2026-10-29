import { canonicalizeJson, sha256Hex } from './security-utils.mjs';
import { assertReadOnlyConfig, loadConnectorConfig } from './connector-config.mjs';

const escapeXml = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export class NCUASimulationExporter {
  constructor({ config = loadConnectorConfig(), signer = null } = {}) {
    assertReadOnlyConfig(config);
    if (config.ncua.mode !== 'SIMULATION_EXPORT') throw new Error('NCUA_SUBMISSION_MODE_INVALID');
    this.config = config;
    this.signer = signer;
  }

  buildDocument(report) {
    if (!report?.payload?.accounts || report.payload.accounts.length !== 26) throw new Error('NCUA_SCHEDULE_J_ACCOUNTS_REQUIRED');
    const accounts = report.payload.accounts.map((account) => `<ncua:Account id="${escapeXml(account.id)}" category="${escapeXml(account.category)}"><ncua:BalanceUnits>${escapeXml(account.balanceUnits)}</ncua:BalanceUnits><ncua:Promoted>${account.promoted ? 'true' : 'false'}</ncua:Promoted><ncua:Digest>${escapeXml(account.digest || '')}</ncua:Digest></ncua:Account>`).join('');
    return `<?xml version="1.0" encoding="UTF-8"?><ncua:ScheduleJ xmlns:ncua="urn:numina:ncua:5300:schedule-j" form="5300" ombControlNumber="3133-0004" mode="SIMULATION_EXPORT"><ncua:ClusterRoot>${escapeXml(report.payload.clusterRoot)}</ncua:ClusterRoot><ncua:Accounts>${accounts}</ncua:Accounts></ncua:ScheduleJ>`;
  }

  async export(report, { keyName } = {}) {
    const xml = this.buildDocument(report);
    const documentDigest = sha256Hex(xml);
    const canonicalDocument = canonicalizeJson({ schema: 'numina.ncua.simulation-document.v1', documentDigest, xml });
    const signature = this.signer ? await this.signer.sign(keyName, canonicalDocument) : null;
    return {
      mode: 'SIMULATION_EXPORT',
      xml,
      documentDigest,
      detachedSignature: signature ? Buffer.from(signature).toString('base64') : null,
      submissionEnabled: false,
    };
  }

  submit() {
    throw new Error('NCUA_SUBMISSION_DISABLED_SIMULATION_ONLY');
  }
}
