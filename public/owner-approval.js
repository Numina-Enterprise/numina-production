// One recorded owner authorization shared by all Numina runtime release records.
export const NUMINA_OWNER_APPROVAL=Object.freeze({
  "schema": "numina.owner-approval.v1",
  "id": "numina-singular-owner-approval-2026-09-16",
  "status": "OWNER_APPROVAL_RECORDED",
  "approved": true,
  "recordedOn": "2026-09-16",
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
    "procurement use is active"
  ],
  "scope": "One singular NUMINA identity across the Numina-controlled software release, signing, fund movement, external-provider action, and active procurement. External completion remains evidenced by actual provider receipts and reconciliation records.",
  "requestSha256": "0af2b7e72cd18f9676f85356da95f8deee8788eac0dee3d587a1278342a401ca",
  "issuerPolicySha256": "1d24f311a34a28d9560db1f32eb3efc4241701c5ae7233b97c2527006623b13d",
  "issuerPolicySigningStatement": Object.freeze({
    "status": "OWNER_REPORTED_SIGNED",
    "ownerReportsSigned": true,
    "recordedOn": "2026-09-17",
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
