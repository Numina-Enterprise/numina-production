// Identity / document verification (IDV) provider interface.
//
// STUB BY DESIGN: verifying government ID documents, liveness or database matches
// requires a licensed IDV provider (for example a contracted vendor with appropriate
// data-processing terms). This module performs NO verification and never returns
// "verified". Wire a real provider by implementing IdvProvider and passing it in.

/** @typedef {{status:'not_performed'|'pending'|'verified'|'failed', provider:string|null, reference:string|null, checkedAt:string|null, note:string}} IdvResult */

export class IdvProvider {
  /** @returns {string} */ get name() { throw new Error('IdvProvider.name not implemented'); }
  /** Start a verification for a party; returns a provider reference. @returns {Promise<IdvResult>} */
  async start(_party) { throw new Error('IdvProvider.start not implemented'); }
  /** Poll / fetch the result for a reference. @returns {Promise<IdvResult>} */
  async result(_reference) { throw new Error('IdvProvider.result not implemented'); }
}

/** Default provider: explicitly not configured. Never fabricates a verification. */
export class NotConfiguredIdvProvider extends IdvProvider {
  get name() { return 'not_configured'; }
  async start() { return notPerformed(); }
  async result() { return notPerformed(); }
}

export function notPerformed() {
  return {status: 'not_performed', provider: null, reference: null, checkedAt: null,
    note: 'Document/ID verification not performed: no licensed IDV provider is configured. Screening and data validation do not verify identity.'};
}
