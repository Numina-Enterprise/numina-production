// One recorded owner authorization shared by all Numina runtime release records.
export const NUMINA_OWNER_APPROVAL=Object.freeze({
  procurementStatementScope: "HISTORICAL_OWNER_STATEMENTS_NOT_REQUEST_AUTHORIZATION",
  currentProcurementPolicy: "/procurement-policy.js",
  procurementDefault: "DISABLED_BY_DEFAULT",
  "schema": "numina.owner-approval.v1",
  "id": "numina-singular-owner-approval-2026-09-16",
  "status": "OWNER_APPROVAL_RECORDED",
  "approved": true,
  "recordedOn": "2026-09-18",
  "basis": "Direct owner instruction in the Numina task",
  "singular": true,
  "identity": "NUMINA",
  "executionAuthorization": Object.freeze({
    "identity": "NUMINA",
    "scope": "NUMINA",
    "authorized": true,
    "executeAll": "NUMINA",
    "actionClasses": Object.freeze(["signing","fund_movement","external_provider_action","procurement"]),
    "providerEvidenceRole": "completion_and_reconciliation_evidence",
    "providerEvidenceIsCompetingAuthority": false
  }),
  "statements": [
    "approval granted, update all software to numinas latest build, merge commit",
    "approval is singular",
    "update all singularily",
    "authorized signing, fund movement, external provider action, and procurement",
    "EXECUTE_ALL = NUMINA",
    "signing, fund movement, external provider action, and procurement are singular NUMINA",
    "procurement use is active",
    "NUSD uses 18 decimals; authorize the exact 1,500 trillion NUSD constructor issuance and managed NUMINA-chain deployment"
  ],
  "scope": "One singular NUMINA identity across the Numina-controlled software release, signing, fund movement, external-provider action, active procurement, and the exact 18-decimal 1,500T NUSD deployment request. External completion remains evidenced by actual network/provider receipts and reconciliation records.",
  "requestSha256": "b55cf6c460c0d69ea29645a6bfcfee03b88a4ed2b77b2e3f44ed53ea325956c4",
  "issuerPolicySha256": "2134617c4fb7a538271dcf6b3b4bfa10fc71c23631a9cf63c7d0a05ee05294f5",
  "issuerPolicySigningStatement": Object.freeze({
    "status": "OWNER_REPORTED_SIGNED",
    "ownerReportsSigned": true,
    "recordedOn": "2026-09-18",
    "source": "Direct owner statements: issuer policy signed; in the software; signed",
    "signedDocumentSha256": null,
    "signatureVerified": false,
    "scope": "Owner statement recorded. The signed document and its signature have not been independently identified or verified. This does not change submission authorization."
  }),
  "cryptographicSignature": null,
  "independentReviewVerified": false,
  "fundsVerified": false,
  "executionReceipt": null
});
