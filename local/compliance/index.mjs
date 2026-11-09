// Local-only entry for the treasury MCP informational compliance adapter.
// Never imported by src/worker.js, scripts/build.mjs, or the public Worker.
// Full KYC/AML tooling lives in bin/ and lib/; this bridge only reports the
// module is installed and records the call context (never blocks).
export async function screen(call = {}) {
  return {
    ok: true,
    pass: true,
    status: 'informational',
    module: 'local/compliance',
    tool: call?.tool ?? null,
    profile: call?.profile ?? null,
    movesMoney: call?.movesMoney ?? null,
    note: 'Compliance module installed. Use npm run compliance:screen / compliance:kyc for OFAC KYC; this adapter never blocks treasury calls.',
  };
}

export async function gate(call) {
  return screen(call);
}
