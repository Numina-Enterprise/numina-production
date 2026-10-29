import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { ContractFactory, keccak256 } from 'ethers';
import { validateDeployment } from './validate-deployment.mjs';
import { loadTokenArtifact, TOKEN_ARTIFACT_SHA256 } from './token-artifact.mjs';

const REVIEW_KEYS = Object.freeze([
  'independentSecurityAudit', 'authorizedIssuerAndJurisdictions', 'custodianAndReserveEvidence',
  'redeemabilityTermsAndOperations', 'financialCrimeAndSanctionsControls', 'independentRoleKeyCustody',
  'incidentAndPauseRecovery', 'applicationSettlementAndFulfillmentReview'
]);
const reviewErrors = new Set(REVIEW_KEYS.map(key => `Review record: ${key} is required`));
const sha256 = value => createHash('sha256').update(value).digest('hex');

/** Offline encoding for reviewers. This schema is never a managed execution manifest. */
export async function prepareReviewDraft(requestFile) {
  const checked = validateDeployment(requestFile);
  const invalidInputs = checked.errors.filter(error => !reviewErrors.has(error));
  if (invalidInputs.length) {
    throw Object.assign(new Error('Constructor inputs are incomplete or invalid'), { code: 'INVALID_CONSTRUCTOR_INPUTS', errors: invalidInputs });
  }
  const artifact = loadTokenArtifact();
  const transaction = await new ContractFactory(artifact.abi, artifact.bytecode).getDeployTransaction(
    checked.cap, checked.initialSupply, checked.initialRecipient,
    checked.roles.admin, checked.roles.issuer, checked.roles.minter, checked.roles.pauser,
    checked.config.adminDelaySeconds, `0x${checked.policyHash}`
  );
  const data = transaction.data;
  // Keep the request bound to the same bytes that passed constructor validation.
  if (sha256(fs.readFileSync(path.resolve(requestFile))) !== checked.requestSha256) {
    throw Object.assign(new Error('The request changed during review preparation'), { code: 'REQUEST_CHANGED' });
  }
  return {
    schema: 'numina.nusd.transaction-review-draft.v1',
    status: 'UNSIGNED_REVIEW_DRAFT_NOT_APPROVED',
    purpose: 'Offline constructor inspection and simulation; not authorization to sign or submit',
    submissionApproved: false, broadcast: false, signature: null,
    transaction: { chainId: checked.config.network.chainId, to: null, from: null, nonce: null,
      gas: null, fee: null, value: '0', data },
    constructor: {
      supplyCapNusd: checked.config.supplyCapNusd, supplyCapBaseUnits: checked.cap.toString(),
      initialSupplyNusd: checked.config.initialSupplyNusd, initialSupplyBaseUnits: checked.initialSupply.toString(),
      initialRecipient: checked.initialRecipient, roles: checked.roles,
      adminDelaySeconds: checked.config.adminDelaySeconds, issuerPolicySha256: checked.policyHash,
      constructorIssuanceRequested: checked.initialSupply > 0n, initiallyPaused: true
    },
    integrity: { requestSha256: checked.requestSha256, sourceSha256: artifact.sourceSha256,
      artifactSha256: TOKEN_ARTIFACT_SHA256, compiler: artifact.compiler,
      creationDataSha256: sha256(Buffer.from(data.slice(2), 'hex')), creationDataKeccak256: keccak256(data) },
    review: { requiredRecords: REVIEW_KEYS, recordPresenceErrors: checked.errors,
      recordPresenceCheckPassed: checked.errors.length === 0, independentReviewsVerified: false,
      warning: 'A reference string or owner authorization does not verify the underlying review.' },
    execution: { managedManifest: null, networkIdentityVerified: false, signerVerified: false,
      nonceAndFeesVerified: false, providerNusdAcceptanceVerified: false, externalReservesVerified: false },
    effects: { contractDeployed: false, tokensIssued: false, nativeTreasuryWritten: false, providerDepositSubmitted: false },
    transactionHash: null, deployedAddress: null, receipt: null
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [request, flag, destination, ...extra] = process.argv.slice(2);
    if (!request || flag !== '--output' || !destination || extra.length) throw new Error('Invalid CLI arguments');
    const draft = await prepareReviewDraft(request);
    const bytes = JSON.stringify(draft, null, 2) + '\n';
    const output = path.resolve(destination);
    if (output === path.resolve(request)) throw new Error('Request and output must differ');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    let reused = false;
    if (fs.existsSync(output)) {
      const stat = fs.lstatSync(output);
      if (!stat.isFile() || stat.isSymbolicLink() || fs.readFileSync(output, 'utf8') !== bytes) throw new Error('Output already contains different content');
      reused = true;
    } else {
      const fd = fs.openSync(output, 'wx');
      try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    }
    console.log(JSON.stringify({ status: draft.status, output, reused,
      unresolvedReviewRecords: draft.review.recordPresenceErrors.length, submissionApproved: false, broadcast: false }));
  } catch (error) {
    console.error(JSON.stringify({ status: 'REVIEW_DRAFT_NOT_CREATED',
      error: error.code === 'INVALID_CONSTRUCTOR_INPUTS' ? error.code : 'REQUEST_OR_OUTPUT_INVALID',
      errors: Array.isArray(error.errors) ? error.errors : [], submissionApproved: false, broadcast: false }));
    process.exitCode = 1;
  }
}
