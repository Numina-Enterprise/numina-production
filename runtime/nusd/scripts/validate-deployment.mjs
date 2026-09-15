import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getAddress, parseUnits, ZeroAddress, ContractFactory } from 'ethers';
import { loadTokenArtifact, TOKEN_ARTIFACT_SHA256 } from './token-artifact.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function validateDeployment(file) {
  const absolute = path.resolve(file);
  let config, requestSha256;
  try {
    const requestBytes = fs.readFileSync(absolute);
    requestSha256 = crypto.createHash('sha256').update(requestBytes).digest('hex');
    config = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(requestBytes));
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error();
  } catch {
    return { config: null, errors: ['Deployment request must be a readable JSON object file'] };
  }
  const errors = [];
  if (config.schema !== 'numina.nusd.deployment.request.v2') errors.push('Deployment schema numina.nusd.deployment.request.v2 is required');
  const required = (value, label) => {
    if (typeof value !== 'string' || value.trim().length < 3 || /^(null|todo|tbd|placeholder)$/i.test(value)) errors.push(`${label} is required`);
  };
  if (!Number.isSafeInteger(config.network?.chainId) || config.network.chainId <= 0) errors.push('A reviewed positive chainId is required');
  required(config.network?.name, 'Network name');
  required(config.network?.finalityPolicy, 'Network finality policy');
  let cap = null;
  try {
    if (typeof config.supplyCapNusd !== 'string' || !/^\d+(\.\d{1,6})?$/.test(config.supplyCapNusd)) throw new Error();
    cap = parseUnits(config.supplyCapNusd, 6);
    if (cap <= 0n || cap >= 2n ** 256n) throw new Error();
  } catch { errors.push('An explicitly approved supply cap in NUSD decimal text is required (maximum 6 decimals)'); }
  let initialSupply = null, initialRecipient = null;
  try {
    if (typeof config.initialSupplyNusd !== 'string' || !/^\d+(\.\d{1,6})?$/.test(config.initialSupplyNusd)) throw new Error();
    initialSupply = parseUnits(config.initialSupplyNusd, 6);
    if (initialSupply < 0n || initialSupply >= 2n ** 256n || cap === null || initialSupply > cap) throw new Error();
  } catch { errors.push('An explicit initial supply from zero through the approved cap in NUSD decimal text is required (maximum 6 decimals)'); }
  try {
    initialRecipient = getAddress(config.initialRecipient);
    if (initialRecipient === ZeroAddress) throw new Error();
  } catch { errors.push('An explicitly approved nonzero initialRecipient address is required, including for zero initial supply'); }
  const roles = {};
  for (const role of ['admin', 'issuer', 'minter', 'pauser']) {
    try {
      roles[role] = getAddress(config.roles?.[role]);
      if (roles[role] === ZeroAddress) throw new Error();
    } catch { errors.push(`A verified ${role} address is required`); }
  }
  if (new Set(Object.values(roles).map(a => a.toLowerCase())).size !== 4) errors.push('All four role addresses must be distinct');
  if (!Number.isSafeInteger(config.adminDelaySeconds) || config.adminDelaySeconds < 0 || config.adminDelaySeconds >= 2 ** 48) errors.push('An explicit admin delay from 0 through 281474976710655 seconds is required');
  required(config.issuer?.legalEntity, 'Legally authorized issuer');
  let policyHash = null;
  try {
    if (!/^[a-fA-F0-9]{64}$/.test(config.issuer?.policySha256)) throw new Error();
    if (typeof config.issuer?.approvedPolicyFile !== 'string') throw new Error();
    const policyFile = path.resolve(path.dirname(absolute), config.issuer.approvedPolicyFile);
    policyHash = crypto.createHash('sha256').update(fs.readFileSync(policyFile)).digest('hex');
    if (policyHash.toLowerCase() !== config.issuer.policySha256.toLowerCase() || /^0+$/.test(policyHash)) throw new Error();
  } catch { errors.push('Approved issuer policy file and matching nonzero SHA-256 are required'); }
  for (const key of [
    'independentSecurityAudit', 'authorizedIssuerAndJurisdictions', 'custodianAndReserveEvidence',
    'redeemabilityTermsAndOperations', 'financialCrimeAndSanctionsControls', 'independentRoleKeyCustody',
    'incidentAndPauseRecovery', 'applicationSettlementAndFulfillmentReview'
  ]) required(config.reviewRecords?.[key], `Review record: ${key}`);
  return { config, cap, initialSupply, initialRecipient, roles, policyHash, requestSha256, errors };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2] || path.join(root, 'deployment.template.json');
  const checked = validateDeployment(file);
  if (process.argv.length > 3 && (process.argv[3] !== '--output' || !process.argv[4] || process.argv.length > 5)) {
    checked.errors.push('Use: validate-deployment.mjs [request.json] [--output unsigned.json]');
  }
  if (checked.errors.length) {
    console.log(JSON.stringify({ valid: false, broadcast: false, errors: checked.errors }, null, 2));
    process.exitCode = 1;
  } else {
    // Runtime contains the exact reviewed artifact, not a compiler or mutable build dependencies.
    const artifact = loadTokenArtifact();
    const factory = new ContractFactory(artifact.abi, artifact.bytecode);
    const data = (await factory.getDeployTransaction(
      checked.cap, checked.initialSupply, checked.initialRecipient,
      checked.roles.admin, checked.roles.issuer, checked.roles.minter, checked.roles.pauser,
      checked.config.adminDelaySeconds, `0x${checked.policyHash}`
    )).data;
    const result = {
      status: 'UNSIGNED_DEPLOYMENT_DATA_ONLY',
      schema: 'numina.nusd.unsigned-deployment.v2',
      warning: 'Record presence checks do not verify audit quality, legal authorization, reserve evidence, key control, or chain identity. Independent reviewers must verify them before a wallet signs.',
      chainId: checked.config.network.chainId, data, value: '0',
      broadcast: false, initialSupplyNusd: checked.config.initialSupplyNusd,
      initialSupplyBaseUnits: checked.initialSupply.toString(), initialRecipient: checked.initialRecipient,
      constructorIssuanceRequested: checked.initialSupply > 0n, initiallyPaused: true,
      sourceSha256: artifact.sourceSha256, compiler: artifact.compiler,
      artifactSha256: TOKEN_ARTIFACT_SHA256,
      requestSha256: checked.requestSha256,
      supplyCapNusd: checked.config.supplyCapNusd, supplyCapBaseUnits: checked.cap.toString(),
      roles: checked.roles, adminDelaySeconds: checked.config.adminDelaySeconds,
      issuerPolicySha256: checked.policyHash,
      transactionHash: null, deployedAddress: null, receipt: null
    };
    const destination = process.argv[4] ? path.resolve(process.argv[4]) : path.join(root, 'artifacts/unsigned-deployment.json');
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ valid: true, broadcast: false, output: destination }));
  }
}
